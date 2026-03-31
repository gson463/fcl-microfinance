/**
 * Supabase functions.invoke: on 4xx the JSON body is often in `data`, not only in `error.context`.
 * Use this to show the real Edge Function error (and optional `stage` / `hint`) in toasts.
 */
export async function getEdgeInvokeFailure(result) {
	const { data, error } = result;
	if (data?.success === true && !error) return null;
	if (!error && data && !data.error) return null;

	let message = '';
	let stage = '';
	let hint = '';

	if (data && typeof data === 'object') {
		if (typeof data.error === 'string') message = data.error;
		else if (data.error != null) message = JSON.stringify(data.error);
		if (typeof data.stage === 'string') stage = data.stage;
		if (typeof data.hint === 'string') hint = data.hint;
	}

	if (!message && error?.message) message = error.message;

	if (error?.context && typeof error.context.json === 'function') {
		try {
			const j = await error.context.json();
			if (j?.error && !message) message = typeof j.error === 'string' ? j.error : JSON.stringify(j.error);
			if (j?.stage && !stage) stage = j.stage;
			if (j?.hint && !hint) hint = j.hint;
		} catch {
			/* ignore */
		}
	}

	if (!message) message = 'Unknown error';

	const parts = [message];
	if (stage) parts.push(`Stage: ${stage}`);
	if (hint) parts.push(hint);

	return {
		message: parts.join('\n'),
		stage,
		hint,
		raw: data ?? error,
	};
}
