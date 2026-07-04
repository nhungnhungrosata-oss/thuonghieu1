import { NextResponse } from 'next/server';
import { getCreditPacks } from '../../../../lib/saas/credit-packs';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, packs: getCreditPacks() });
}
