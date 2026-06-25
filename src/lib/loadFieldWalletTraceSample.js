import { FIELD_WALLET_TRACE_SAMPLE } from '@/lib/fieldWalletTraceSampleData';

/** Apply static dummy snapshot (same shape as fetchAdminFieldWalletSnapshot). */
export function loadFieldWalletTraceSample() {
  const { currency, blocks, withdrawByOfficer: withdrawRaw } = FIELD_WALLET_TRACE_SAMPLE;
  const withdrawByOfficer = new Map(Object.entries(withdrawRaw));
  const repaymentTotalsByOfficer = new Map(
    blocks.map((b) => {
      const coll =
        Number(b.totals.collectionWithoutPrepayment || 0) + Number(b.totals.prepayment || 0);
      return [b.officer.id, coll];
    })
  );
  return {
    currency,
    applicationFee: 5000,
    blocks,
    withdrawByOfficer,
    repaymentTotalsByOfficer,
  };
}

export function isFieldWalletTraceDummyMode(searchParams) {
  const v = searchParams.get('dummy') ?? searchParams.get('demo');
  return v === '1' || v === 'true' || v === 'yes';
}
