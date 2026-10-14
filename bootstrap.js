import { proxyAdminContract } from '../../_lib/admin-contracts.js';
export const onRequestGet = context => proxyAdminContract(context, 'bootstrap', 'GET');
