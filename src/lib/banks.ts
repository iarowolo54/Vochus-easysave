// Nigerian banks people can be paid into. A fixed list that ships with the app, so choosing a bank never depends on
// an outside service. The code is only our own id for the bank (the same ids saved before, so old records still
// line up); staff pay by the bank's name and the account number and name the person gave.
// Safe to import from client components: no server-only code here.
export type Bank = { code: string; name: string }

export const NIGERIAN_BANKS: readonly Bank[] = [
  { code: '044', name: 'Access Bank' },
  { code: '063', name: 'Access Bank (Diamond)' },
  { code: '035A', name: 'ALAT by WEMA' },
  { code: '401', name: 'ASO Savings and Loans' },
  { code: '565', name: 'Carbon' },
  { code: '023', name: 'Citibank Nigeria' },
  { code: '050', name: 'Ecobank Nigeria' },
  { code: '562', name: 'Ekondo Microfinance Bank' },
  { code: '51318', name: 'FairMoney Microfinance Bank' },
  { code: '070', name: 'Fidelity Bank' },
  { code: '011', name: 'First Bank of Nigeria' },
  { code: '214', name: 'First City Monument Bank' },
  { code: '00103', name: 'Globus Bank' },
  { code: '058', name: 'Guaranty Trust Bank' },
  { code: '030', name: 'Heritage Bank' },
  { code: '301', name: 'Jaiz Bank' },
  { code: '082', name: 'Keystone Bank' },
  { code: '50211', name: 'Kuda Microfinance Bank' },
  { code: '303', name: 'Lotus Bank' },
  { code: '50304', name: 'Mint MFB' },
  { code: '50515', name: 'Moniepoint Microfinance Bank' },
  { code: '999992', name: 'OPay' },
  { code: '327', name: 'Paga' },
  { code: '999991', name: 'PalmPay' },
  { code: '104', name: 'Parallex Bank' },
  { code: '076', name: 'Polaris Bank' },
  { code: '105', name: 'PremiumTrust Bank' },
  { code: '101', name: 'Providus Bank' },
  { code: '125', name: 'Rubies MFB' },
  { code: '51310', name: 'Sparkle Microfinance Bank' },
  { code: '221', name: 'Stanbic IBTC Bank' },
  { code: '068', name: 'Standard Chartered Bank' },
  { code: '232', name: 'Sterling Bank' },
  { code: '100', name: 'Suntrust Bank' },
  { code: '302', name: 'TAJ Bank' },
  { code: '102', name: 'Titan Bank' },
  { code: '032', name: 'Union Bank of Nigeria' },
  { code: '033', name: 'United Bank for Africa' },
  { code: '215', name: 'Unity Bank' },
  { code: '566', name: 'VFD Microfinance Bank' },
  { code: '035', name: 'Wema Bank' },
  { code: '057', name: 'Zenith Bank' },
]

/** The bank for a code, or null when it isn't on the list. */
export const bankByCode = (code: unknown): Bank | null =>
  typeof code === 'string' ? NIGERIAN_BANKS.find(b => b.code === code) ?? null : null
