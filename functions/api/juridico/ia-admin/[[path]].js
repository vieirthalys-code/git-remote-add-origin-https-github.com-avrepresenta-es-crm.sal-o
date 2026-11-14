import { proxyN8n } from '../../../_lib/n8n-proxy.js';

// Proxy de mesma origem -> webhook n8n do IA Admin Jurídico (com retry seguro).
const BASE = 'https://possessivebull-n8n.cloudfy.live/webhook/crm-juridico/ia-admin';

export const onRequestPost = (context) => proxyN8n(context, BASE);
