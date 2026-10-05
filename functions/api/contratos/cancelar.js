import { proxyAdminContract } from '../../_lib/admin-contracts.js';
export const onRequestPost = context => proxyAdminContract(context, 'cancelar', 'POST');
