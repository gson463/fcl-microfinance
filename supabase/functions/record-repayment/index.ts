import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { getClientIp, geoLabelFromIp } from "../_shared/audit.ts";
import {
  installmentUnitFromSchedule,
  isValidRepaymentAmount,
} from "../_shared/repaymentAmount.ts";
import { isAuditExemptEmail } from "../_shared/auditExempt.ts";

/** Fire-and-forget audit so the client gets a fast response (geo lookup can be slow). */
function scheduleRepaymentAudit(
  supabaseAdmin: ReturnType<typeof createClient>,
  req: Request,
  params: {
    officer_id: string;
    loan_id: string;
    amt: number;
    actual_payment_date: string;
    prepayment: number;
    due: number;
    wallet_split_explicit?: boolean;
  },
) {
  const run = async () => {
    try {
      const { data: actorRow } = await supabaseAdmin
        .from("users")
        .select("email")
        .eq("id", params.officer_id)
        .maybeSingle();
      if (isAuditExemptEmail(actorRow?.email)) {
        return;
      }
      const ip = getClientIp(req);
      let location_label: string | null = null;
      try {
        location_label = await geoLabelFromIp(ip);
      } catch {
        /* geo optional */
      }
      const base = {
        action: "repayment.record" as const,
        entity_type: "loan",
        entity_id: String(params.loan_id),
        metadata: {
          amount: params.amt,
          actual_payment_date: params.actual_payment_date,
          prepayment_amount: params.prepayment,
          scheduled_due_snapshot: params.due,
          ...(params.wallet_split_explicit ? { wallet_split: "explicit" as const } : {}),
        },
        ip_address: ip,
        user_agent: req.headers.get("user-agent"),
        device_summary: null as string | null,
        location_label,
      };
      const { error: e1 } = await supabaseAdmin.from("audit_logs").insert({
        ...base,
        user_id: params.officer_id,
      });
      if (e1) {
        await supabaseAdmin.from("audit_logs").insert({
          ...base,
          user_id: null,
          metadata: {
            ...base.metadata,
            officer_id: params.officer_id,
            audit_note: "user_id insert failed; FK or RLS — logged without user link",
          },
        });
      }
    } catch {
      /* audit must never affect repayment outcome */
    }
  };
  const er = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er?.waitUntil) {
    er.waitUntil(run());
  } else {
    void run();
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const body = await req.json() as Record<string, unknown>;
    const { loan_id, officer_id, actual_payment_date } = body;
    if (!loan_id || !officer_id || !actual_payment_date) {
      return new Response(
        JSON.stringify({ error: "loan_id, officer_id, actual_payment_date required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: loan, error: loanErr } = await supabaseAdmin
      .from("loans")
      .select("borrower_id, schedule")
      .eq("id", loan_id)
      .single();
    if (loanErr || !loan) throw new Error("Loan not found");

    const payDate = String(actual_payment_date).slice(0, 10);

    const unit = installmentUnitFromSchedule(loan.schedule);
    if (unit == null) {
      throw new Error("Cannot determine installment unit from loan schedule");
    }

    /** Record Collection split form: store wallet as officer entered (not RPC due). */
    const walletExplicitFlag =
      body.wallet_split_explicit === true ||
      body.wallet_split_explicit === "true" ||
      body.wallet_split_explicit === 1 ||
      body.wallet_split_explicit === "1";

    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
    const hasSchedKey = has("scheduled_portion");
    const hasPrepKey = has("prepayment_portion");

    /** Use explicit split when officer asked for it, or when both split fields are sent, or prepayment+amount without scheduled key (0 often omitted from JSON). */
    const wantsExplicitSplit =
      walletExplicitFlag ||
      (hasSchedKey && hasPrepKey) ||
      (hasPrepKey && body.amount != null && !hasSchedKey);

    let amt: number;
    let prepayment: number;
    let snapshotDue: number;
    let walletSplitExplicit = false;

    if (wantsExplicitSplit) {
      let s: number;
      let p: number;
      if (hasSchedKey && hasPrepKey) {
        s = Number(body.scheduled_portion);
        p = Number(body.prepayment_portion);
      } else if (body.amount != null && hasPrepKey && !hasSchedKey) {
        p = Number(body.prepayment_portion);
        const total = Number(body.amount);
        s = total - p;
      } else {
        throw new Error(
          "Split recording: send scheduled_portion + prepayment_portion, or amount + prepayment_portion (when scheduled is 0 or omitted).",
        );
      }
      if (!Number.isFinite(s) || !Number.isFinite(p) || s < -1e-9 || p < -1e-9) {
        throw new Error("scheduled_portion and prepayment_portion must be non-negative numbers");
      }
      amt = s + p;
      if (!Number.isFinite(amt) || amt <= 0) {
        throw new Error("Total (scheduled + prepayment) must be positive");
      }
      if (body.amount != null && Math.abs(Number(body.amount) - amt) > 0.02) {
        throw new Error("amount must equal scheduled_portion + prepayment_portion");
      }
      if (!isValidRepaymentAmount(amt, 0, unit)) {
        throw new Error(
          `Total must be a multiple of ${unit.toFixed(2)} and at least one installment (${unit.toFixed(2)})`,
        );
      }
      prepayment = p;
      snapshotDue = s;
      walletSplitExplicit = true;
    } else {
      if (body.amount == null) {
        return new Response(
          JSON.stringify({ error: "amount required (or scheduled_portion + prepayment_portion)" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      amt = Number(body.amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return new Response(JSON.stringify({ error: "amount must be a positive number" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: modeRow } = await supabaseAdmin
        .from("system_config")
        .select("value")
        .eq("key", "walletPrepaymentSplitMode")
        .maybeSingle();
      const splitMode = String(modeRow?.value ?? "arrears_only").trim();
      const dueRpc =
        splitMode === "arrears_only"
          ? "scheduled_due_strictly_before_payment_date"
          : "scheduled_due_for_payment_date";

      const { data: dueRaw, error: dueErr } = await supabaseAdmin.rpc(dueRpc, {
        p_schedule: loan.schedule,
        p_payment_date: payDate,
      });
      if (dueErr) throw dueErr;

      const due = Number(dueRaw ?? 0);
      if (!isValidRepaymentAmount(amt, due, unit)) {
        throw new Error(
          `Amount must be a multiple of ${unit.toFixed(2)} and at least one installment (${unit.toFixed(2)})`,
        );
      }
      prepayment = Math.max(0, amt - due);
      snapshotDue = due;
    }

    const prepSafe = Number.isFinite(prepayment) ? prepayment : 0;
    const snapSafe = Number.isFinite(snapshotDue) ? snapshotDue : 0;
    const walletSrc = walletSplitExplicit ? "explicit" : "rpc";

    /** Prefer atomic RPC; if missing on DB (old project), fall back to insert + recalculate so prepayment_amount / scheduled_due_snapshot are never left at default NULL/0. */
    let repaymentId: string | null = null;
    const { data: rpcRepaymentId, error: walletRpcErr } = await supabaseAdmin.rpc(
      "record_repayment_wallet_then_recalculate",
      {
        p_loan_id: loan_id,
        p_borrower_id: loan.borrower_id,
        p_amount: amt,
        p_officer_id: officer_id,
        p_actual_payment_date: payDate,
        p_prepayment_amount: prepSafe,
        p_scheduled_due_snapshot: snapSafe,
        p_wallet_split_source: walletSrc,
      },
    );

    if (!walletRpcErr) {
      repaymentId = rpcRepaymentId != null ? String(rpcRepaymentId) : null;
    } else {
      const msg = String(walletRpcErr.message ?? "");
      const rpcUnavailable =
        /does not exist|42883|function public\.record_repayment_wallet_then_recalculate/i.test(msg) ||
        msg.includes("record_repayment_wallet_then_recalculate");
      if (!rpcUnavailable) {
        throw walletRpcErr;
      }
      const { data: insRow, error: insErr } = await supabaseAdmin
        .from("repayments")
        .insert({
          loan_id,
          borrower_id: loan.borrower_id,
          amount: amt,
          officer_id,
          payment_date: actual_payment_date,
          actual_payment_date: actual_payment_date,
          prepayment_amount: prepSafe,
          scheduled_due_snapshot: snapSafe,
          wallet_split_source: walletSrc,
        })
        .select("id")
        .single();
      if (insErr) {
        throw new Error(
          insErr.message +
            (rpcUnavailable
              ? " (Also: run migrations for record_repayment_wallet_then_recalculate and wallet columns.)"
              : ""),
        );
      }
      repaymentId = insRow?.id != null ? String(insRow.id) : null;
      const { error: rpc1 } = await supabaseAdmin.rpc("recalculate_loan_schedule", {
        p_loan_id: loan_id,
      });
      if (rpc1) throw rpc1;
    }

    const { error: rpc2 } = await supabaseAdmin.rpc("update_all_loan_statuses");
    if (rpc2) throw rpc2;

    scheduleRepaymentAudit(supabaseAdmin, req, {
      officer_id,
      loan_id: String(loan_id),
      amt,
      actual_payment_date,
      prepayment: prepSafe,
      due: snapSafe,
      wallet_split_explicit: walletSplitExplicit,
    });

    return new Response(
      JSON.stringify({
        message: "Repayment recorded successfully!",
        repayment_id: repaymentId ?? null,
        /** Persisted on public.repayments before schedule allocation; used by wallet & reports. */
        wallet: {
          amount: amt,
          prepayment_amount: prepSafe,
          scheduled_due_snapshot: snapSafe,
          wallet_split_source: walletSrc,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
