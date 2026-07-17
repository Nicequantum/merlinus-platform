/**
 * H1: Single source of truth for Customer Pay repair-line classification.
 * Client and server must use this helper so UI guards match API enforcement.
 */
export function isCustomerPayRepairLine(line: { isCustomerPay?: boolean | null } | null | undefined): boolean {
  return line?.isCustomerPay === true;
}