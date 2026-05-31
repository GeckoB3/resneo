/** Map ISO currency code to display symbol. Defaults to GBP (£) for Resneo. */
export function currencySymbolFromCode(code: string | null | undefined): string {
  return code === 'EUR' ? '€' : '£';
}
