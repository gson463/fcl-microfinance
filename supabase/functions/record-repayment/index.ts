import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { getClientIp, geoLabelFromIp } from "../_shared/audit.ts";
import {
  installmentUnitFromSchedule,
  isValidRepaymentAmount,
} from "../_shared/repaymentAmount.ts";

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
  },
) {
  const run = async () => {
    try {
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
    const body = await req.json();
    const { loan_id, amount, officer_id, actual_payment_date } = body;
    if (!loan_id || amount == null || !officer_id || !actual_payment_date) {
      return new Response(
        JSON.stringify({ error: "loan_id, amount, officer_id, actual_payment_date required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return new Response(JSON.stringify({ error: "amount must be a positive number" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: loan, error: loanErr } = await supabaseAdmin
      .from("loans")
      .select("borrower_id, schedule")
      .eq("id", loan_id)
      .single();
    if (loanErr || !loan) throw new Error("Loan not found");

    const payDate = String(actual_payment_date).slice(0, 10);

    const { data: dueRaw, error: dueErr } = await supabaseAdmin.rpc(
      "scheduled_due_for_payment_date",
      {
        p_schedule: loan.schedule,
        p_payment_date: payDate,
      },
    );
    if (dueErr) throw dueErr;

    const due = Number(dueRaw ?? 0);
    const unit = installmentUnitFromSchedule(loan.schedule);
    if (unit == null) {
      throw new Error("Cannot determine installment unit from loan schedule");
    }
    if (!isValidRepaymentAmount(amt, due, unit)) {
      throw new Error(
        `Amount must be a multiple of ${unit.toFixed(2)} and at least one installment (${unit.toFixed(2)})`,
      );
    }
    const prepayment = Math.max(0, amt - due);

    const { error: insErr } = await supabaseAdmin.from("repayments").insert({
      loan_id,
      borrower_id: loan.borrower_id,
      amount: amt,
      officer_id,
      payment_date: actual_payment_date,
      actual_payment_date: actual_payment_date,
      prepayment_amount: prepayment,
      scheduled_due_snapshot: due,
    });
    if (insErr) throw insErr;

    const { error: rpc1 } = await supabaseAdmin.rpc("recalculate_loan_schedule", {
      p_loan_id: loan_id,
    });
    if (rpc1) throw rpc1;

    const { error: rpc2 } = await supabaseAdmin.rpc("update_all_loan_statuses");
    if (rpc2) throw rpc2;

    scheduleRepaymentAudit(supabaseAdmin, req, {
      officer_id,
      loan_id: String(loan_id),
      amt,
      actual_payment_date,
      prepayment,
      due,
    });

    return new Response(
      JSON.stringify({ message: "Repayment recorded successfully!" }),
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
