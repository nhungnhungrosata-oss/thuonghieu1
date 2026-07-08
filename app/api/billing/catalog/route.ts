import { NextResponse } from 'next/server';
import { getCreditPacks } from '../../../../lib/saas/billing';

export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ ok: true, packs: getCreditPacks() });
}
