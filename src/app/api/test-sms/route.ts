import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { sendSMS } from '@/lib/sms';

// Set TEST_SMS_RECIPIENT in .env.local to a number verified in your Twilio console (required for trial accounts).
const TEST_RECIPIENT =
  process.env.TEST_SMS_RECIPIENT ?? '+447700900000';
const ENABLED = process.env.ENABLE_TEST_SMS_ENDPOINT === 'true';

export async function POST() {
  if (!ENABLED) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const result = await sendSMS(
      TEST_RECIPIENT,
      'Resneo test: SMS integration is working.'
    );
    return NextResponse.json({
      success: true,
      messageSid: result.sid,
      to: TEST_RECIPIENT,
    });
  } catch (error) {
    console.error('Test SMS failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send SMS',
      },
      { status: 500 }
    );
  }
}
