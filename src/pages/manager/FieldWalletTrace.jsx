import { FieldWalletTracePage } from '@/pages/shared/FieldWalletTracePage';

/** Manager field wallet trace — fixed to manager branch, officer filter only. */
export default function ManagerFieldWalletTrace() {
	return <FieldWalletTracePage scopeRole="manager" />;
}
