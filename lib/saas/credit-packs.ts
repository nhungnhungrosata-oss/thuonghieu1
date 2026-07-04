export type CreditPack = {
  id: 'starter' | 'pro' | 'business';
  name: string;
  description: string;
  credits: number;
  targetPlan: 'starter' | 'pro' | 'business';
  amount: number;
  currency: string;
  highlighted?: boolean;
};

function readPositiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readCurrency() {
  const value = (process.env.STRIPE_CURRENCY || 'usd').trim().toLowerCase();
  return /^[a-z]{3}$/.test(value) ? value : 'usd';
}

export function getCreditPacks(): CreditPack[] {
  const currency = readCurrency();
  return [
    {
      id: 'starter',
      name: 'Starter',
      description: 'Phù hợp người mới bắt đầu bán hàng bằng video AI.',
      credits: 50,
      targetPlan: 'starter',
      amount: readPositiveInteger('STRIPE_STARTER_AMOUNT', 990),
      currency
    },
    {
      id: 'pro',
      name: 'Pro',
      description: 'Dành cho người tạo nội dung thường xuyên và đội bán hàng nhỏ.',
      credits: 150,
      targetPlan: 'pro',
      amount: readPositiveInteger('STRIPE_PRO_AMOUNT', 2490),
      currency,
      highlighted: true
    },
    {
      id: 'business',
      name: 'Business',
      description: 'Dành cho đội nhóm cần hạn mức cao và lưu video lâu hơn.',
      credits: 400,
      targetPlan: 'business',
      amount: readPositiveInteger('STRIPE_BUSINESS_AMOUNT', 5990),
      currency
    }
  ];
}

export function getCreditPack(packId: string) {
  return getCreditPacks().find((pack) => pack.id === packId) || null;
}

export function formatMoney(amount: number, currency: string) {
  const zeroDecimalCurrencies = new Set([
    'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf',
    'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'
  ]);
  const divisor = zeroDecimalCurrencies.has(currency.toLowerCase()) ? 1 : 100;
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: currency.toUpperCase()
  }).format(amount / divisor);
}
