-- "Projected tomorrow" uses CURRENT_DATE + 1 only — public/institutional holidays do not shift the due date used for this KPI.

COMMENT ON FUNCTION public.get_admin_dashboard_metrics(date, date, uuid, uuid, int) IS
  'Scoped dashboard KPIs. expected_tomorrow sums unpaid schedule installments due on CURRENT_DATE + 1 (calendar in DB timezone); public holidays are not applied to adjust that date.';

COMMENT ON FUNCTION public.get_admin_dashboard_drilldown(text, date, date, int, int, uuid, uuid, int, uuid, uuid) IS
  'Paged drilldown per metric key. Metric expected_tomorrow uses unpaid installments due on CURRENT_DATE + 1 (calendar only; holidays do not alter this date).';

COMMENT ON FUNCTION public.officer_projected_tomorrow_by_center(uuid, uuid, date) IS
  'Loan officer: unpaid installment amounts grouped by borrower centre, due on calendar tomorrow (CURRENT_DATE + 1 in DB timezone). Public holidays are not used to shift dates; unused p_period_end retained for compatibility.';
