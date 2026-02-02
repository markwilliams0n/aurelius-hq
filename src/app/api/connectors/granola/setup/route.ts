import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { saveCredentials, getCredentials, getAccessToken } from '@/lib/granola';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { refresh_token, client_id } = await request.json();

    if (!refresh_token || !client_id) {
      return NextResponse.json(
        { error: 'refresh_token and client_id are required' },
        { status: 400 }
      );
    }

    // Save initial credentials
    await saveCredentials({
      refresh_token,
      client_id,
    });

    // Test the credentials by getting an access token
    // This also saves the rotated refresh token
    try {
      await getAccessToken();
    } catch (error) {
      // Clear invalid credentials
      await saveCredentials({
        refresh_token: '',
        client_id: '',
      });
      return NextResponse.json(
        { error: 'Invalid credentials - token refresh failed', details: String(error) },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Granola connected successfully',
    });
  } catch (error) {
    console.error('Granola setup error:', error);
    return NextResponse.json(
      { error: 'Setup failed', details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const creds = await getCredentials();

  return NextResponse.json({
    configured: !!(creds?.refresh_token && creds?.client_id),
    lastSynced: creds?.last_synced_at || null,
  });
}

export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await saveCredentials({
    refresh_token: '',
    client_id: '',
  });

  return NextResponse.json({ success: true, message: 'Granola disconnected' });
}
