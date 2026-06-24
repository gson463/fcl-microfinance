-- Reports page: server-side metrics (Phase 2) — aligns with dashboard date/scope rules.

CREATE OR REPLACE FUNCTION public.reports_prepayment_amount(
  p_amount numeric,
  p_prepayment_amount numeric,
  p_scheduled_due_snapshot numeric,
  p_wallet_split_source text
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_amt numeric := COALESCE(p_amount, 0);
  v_pa numeric := COALESCE(p_prepayment_amount, 0);
  v_snap numeric;
  v_from_snap numeric;
BEGIN
  IF lower(COALESCE(p_wallet_split_source, '')) = 'explicit' THEN
    IF v_pa >= 0 THEN
      RETURN LEAST(GREATEST(0, v_pa), v_amt);
    END IF;
    RETURN 0;
  END IF;

  IF p_scheduled_due_snapshot IS NOT NULL AND p_scheduled_due_snapshot::text <> '' THEN
    v_snap := p_scheduled_due_snapshot::numeric;
    IF v_snap IS NOT NULL THEN
      v_from_snap := GREATEST(0, v_amt - v_snap);
      IF v_pa >= 0 AND abs(v_pa - v_from_snap) < 0.05 THEN
        RETURN LEAST(GREATEST(0, v_pa), v_amt);
      END IF;
      IF v_pa >= 0 AND v_pa > v_from_snap + 0.05 THEN
        RETURN LEAST(v_pa, v_amt);
      END IF;
      RETURN v_from_snap;
    END IF;
  END IF;

  RETURN GREATEST(0, LEAST(CASE WHEN v_pa >= 0 THEN v_pa ELSE 0 END, v_amt));
END;
$$;

COMMENT ON FUNCTION public.reports_prepayment_amount(numeric, numeric, numeric, text) IS
  'Prepayment portion for Reports (mirrors src/lib/repaymentPrepayment.js).';

GRANT EXECUTE ON FUNCTION public.reports_prepayment_amount(numeric, numeric, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_reports_metrics(
  p_start_date date,
  p_end_date date,
  p_branch_id uuid DEFAULT NULL,
  p_officer_id uuid DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_center_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_granularity text DEFAULT 'day'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_branch uuid;
  v_officer uuid;
  v_status text;
  v_granularity text;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Invalid date range' USING ERRCODE = '22023';
  END IF;

  v_role := public.auth_app_role();
  v_status := NULLIF(trim(COALESCE(p_status, '')), '');
  IF v_status = 'all' THEN
    v_status := NULL;
  END IF;

  v_granularity := lower(COALESCE(p_granularity, 'day'));
  IF v_granularity NOT IN ('day', 'month') THEN
    v_granularity := 'day';
  END IF;

  IF v_role = 'admin' THEN
    v_branch := p_branch_id;
    v_officer := p_officer_id;
  ELSIF v_role = 'manager' THEN
    v_branch := public.auth_app_branch_id();
    IF v_branch IS NULL THEN
      RAISE EXCEPTION 'Branch not assigned' USING ERRCODE = '42501';
    END IF;
    IF p_branch_id IS NOT NULL AND p_branch_id IS DISTINCT FROM v_branch THEN
      RAISE EXCEPTION 'Branch out of scope' USING ERRCODE = '42501';
    END IF;
    v_officer := p_officer_id;
    IF v_officer IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = v_officer AND u.role = 'officer' AND u.branch_id = v_branch
    ) THEN
      RAISE EXCEPTION 'Officer out of scope' USING ERRCODE = '42501';
    END IF;
  ELSIF v_role = 'officer' THEN
    v_officer := auth.uid();
    v_branch := NULL;
  ELSE
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH scoped_loans AS (
      SELECT
        l.id,
        l.borrower_id,
        l.officer_id,
        l.product_id,
        l.status,
        l.balance,
        l.principal,
        l.disbursement_date,
        b.branch_id,
        b.group_id,
        g.center_id
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.groups g ON g.id = b.group_id
      JOIN public.users u ON u.id = l.officer_id
      WHERE
        (
          v_role = 'admin'
          OR (v_role = 'manager' AND u.branch_id = v_branch)
          OR (v_role = 'officer' AND l.officer_id = v_officer)
        )
        AND (v_branch IS NULL OR b.branch_id = v_branch)
        AND (v_officer IS NULL OR l.officer_id = v_officer)
        AND (p_product_id IS NULL OR l.product_id = p_product_id)
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
        AND (p_center_id IS NULL OR g.center_id = p_center_id)
        AND (v_status IS NULL OR l.status = v_status)
    ),
    scoped_repayments AS (
      SELECT
        r.id,
        r.loan_id,
        r.officer_id,
        r.amount,
        r.prepayment_amount,
        r.scheduled_due_snapshot,
        r.wallet_split_source,
        r.actual_payment_date,
        r.payment_date,
        public.reports_prepayment_amount(
          r.amount,
          r.prepayment_amount,
          r.scheduled_due_snapshot,
          r.wallet_split_source
        ) AS prepay
      FROM public.repayments r
      JOIN scoped_loans sl ON sl.id = r.loan_id
      WHERE COALESCE(r.actual_payment_date, r.payment_date)::date BETWEEN p_start_date AND p_end_date
    ),
    summary AS (
      SELECT
        COALESCE((SELECT SUM(sl.balance) FROM scoped_loans sl), 0) AS total_portfolio,
        COALESCE((
          SELECT SUM(sl.principal) FROM scoped_loans sl
          WHERE sl.disbursement_date::date BETWEEN p_start_date AND p_end_date
        ), 0) AS principal_disbursed,
        COALESCE((SELECT SUM(sr.amount) FROM scoped_repayments sr), 0) AS repayments_collected,
        COALESCE((SELECT SUM(sr.prepay) FROM scoped_repayments sr), 0) AS prepayments_collected,
        COALESCE((
          SELECT COUNT(*)::bigint FROM scoped_loans sl
          WHERE sl.status IN ('active', 'delinquent', 'defaulted')
        ), 0) AS active_loans,
        COALESCE((SELECT COUNT(DISTINCT sl.borrower_id)::bigint FROM scoped_loans sl), 0) AS total_borrowers,
        COALESCE((
          SELECT SUM(sl.balance) FROM scoped_loans sl
          WHERE sl.status IN ('delinquent', 'defaulted')
        ), 0) AS par_balance
    ),
    time_buckets AS (
      SELECT gs::date AS bucket_date
      FROM generate_series(
        CASE WHEN v_granularity = 'month' THEN date_trunc('month', p_start_date::timestamp)::date ELSE p_start_date END,
        p_end_date,
        CASE WHEN v_granularity = 'month' THEN '1 month'::interval ELSE '1 day'::interval END
      ) gs
    ),
    disbursed_by_bucket AS (
      SELECT
        CASE
          WHEN v_granularity = 'month' THEN date_trunc('month', sl.disbursement_date::timestamp)::date
          ELSE sl.disbursement_date::date
        END AS bucket_date,
        SUM(sl.principal) AS disbursed
      FROM scoped_loans sl
      WHERE sl.disbursement_date::date BETWEEN p_start_date AND p_end_date
      GROUP BY 1
    ),
    repayments_by_bucket AS (
      SELECT
        CASE
          WHEN v_granularity = 'month' THEN date_trunc('month', COALESCE(sr.actual_payment_date, sr.payment_date)::timestamp)::date
          ELSE COALESCE(sr.actual_payment_date, sr.payment_date)::date
        END AS bucket_date,
        SUM(GREATEST(0, COALESCE(sr.amount, 0) - COALESCE(sr.prepay, 0))) AS scheduled,
        SUM(COALESCE(sr.prepay, 0)) AS prepayment
      FROM scoped_repayments sr
      GROUP BY 1
    ),
    time_series AS (
      SELECT COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'bucket_date', tb.bucket_date,
              'disbursed', COALESCE(db.disbursed, 0),
              'scheduled', COALESCE(rb.scheduled, 0),
              'prepayment', COALESCE(rb.prepayment, 0)
            )
            ORDER BY tb.bucket_date
          )
          FROM time_buckets tb
          LEFT JOIN disbursed_by_bucket db ON db.bucket_date = tb.bucket_date
          LEFT JOIN repayments_by_bucket rb ON rb.bucket_date = tb.bucket_date
        ),
        '[]'::jsonb
      ) AS data
    ),
    status_distribution AS (
      SELECT COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'status', st.status,
              'count', st.cnt
            )
            ORDER BY st.status
          )
          FROM (
            SELECT sl.status, COUNT(*)::bigint AS cnt
            FROM scoped_loans sl
            GROUP BY sl.status
          ) st
        ),
        '[]'::jsonb
      ) AS data
    ),
    product_portfolio AS (
      SELECT COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'product_id', pp.product_id,
              'product_name', pp.product_name,
              'portfolio', pp.portfolio
            )
            ORDER BY pp.product_name
          )
          FROM (
            SELECT
              lp.id AS product_id,
              lp.name AS product_name,
              SUM(sl.balance) AS portfolio
            FROM scoped_loans sl
            JOIN public.loan_products lp ON lp.id = sl.product_id
            GROUP BY lp.id, lp.name
            HAVING SUM(sl.balance) > 0
          ) pp
        ),
        '[]'::jsonb
      ) AS data
    ),
    branch_performance AS (
      SELECT CASE WHEN v_role = 'admin' THEN COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'branch_id', br.id,
              'branch', br.name,
              'portfolio', COALESCE(bp.portfolio, 0),
              'par', CASE WHEN COALESCE(bp.portfolio, 0) > 0 THEN round((COALESCE(bp.par_balance, 0) / bp.portfolio) * 100, 2) ELSE 0 END,
              'officers', (
                SELECT COUNT(*)::bigint FROM public.users u
                WHERE u.role = 'officer' AND u.branch_id = br.id
              )
            )
            ORDER BY br.name
          )
          FROM public.branches br
          LEFT JOIN (
            SELECT
              sl.branch_id,
              SUM(sl.balance) AS portfolio,
              SUM(sl.balance) FILTER (WHERE sl.status IN ('delinquent', 'defaulted')) AS par_balance
            FROM scoped_loans sl
            GROUP BY sl.branch_id
          ) bp ON bp.branch_id = br.id
          WHERE v_branch IS NULL OR br.id = v_branch
        ),
        '[]'::jsonb
      ) ELSE '[]'::jsonb END AS data
    ),
    officer_performance AS (
      SELECT CASE WHEN v_role IN ('admin', 'manager') THEN COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'officer_id', u.id,
              'officer', u.full_name,
              'portfolio', COALESCE(op.portfolio, 0),
              'par', CASE WHEN COALESCE(op.portfolio, 0) > 0 THEN round((COALESCE(op.par_balance, 0) / op.portfolio) * 100, 2) ELSE 0 END,
              'loans', COALESCE(op.active_loans, 0)
            )
            ORDER BY u.full_name
          )
          FROM public.users u
          LEFT JOIN (
            SELECT
              sl.officer_id,
              SUM(sl.balance) AS portfolio,
              SUM(sl.balance) FILTER (WHERE sl.status IN ('delinquent', 'defaulted')) AS par_balance,
              COUNT(*) FILTER (WHERE sl.status IN ('active', 'delinquent', 'defaulted'))::bigint AS active_loans
            FROM scoped_loans sl
            GROUP BY sl.officer_id
          ) op ON op.officer_id = u.id
          WHERE u.role = 'officer'
            AND (v_branch IS NULL OR u.branch_id = v_branch)
            AND (v_officer IS NULL OR u.id = v_officer)
        ),
        '[]'::jsonb
      ) ELSE '[]'::jsonb END AS data
    )
    SELECT jsonb_build_object(
      'summary', (
        SELECT jsonb_build_object(
          'total_portfolio', s.total_portfolio,
          'principal_disbursed', s.principal_disbursed,
          'repayments_collected', s.repayments_collected,
          'prepayments_collected', s.prepayments_collected,
          'active_loans', s.active_loans,
          'total_borrowers', s.total_borrowers,
          'par_pct', CASE WHEN s.total_portfolio > 0 THEN round((s.par_balance / s.total_portfolio) * 100, 2) ELSE 0 END
        )
        FROM summary s
      ),
      'time_series', (SELECT data FROM time_series),
      'status_distribution', (SELECT data FROM status_distribution),
      'product_portfolio', (SELECT data FROM product_portfolio),
      'branch_performance', (SELECT data FROM branch_performance),
      'officer_performance', (SELECT data FROM officer_performance)
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_reports_metrics(date, date, uuid, uuid, uuid, uuid, uuid, text, text) IS
  'Reports page metrics: summary, time series, status/product charts, branch/officer performance. Respects auth role scope.';

GRANT EXECUTE ON FUNCTION public.get_reports_metrics(date, date, uuid, uuid, uuid, uuid, uuid, text, text) TO authenticated;
