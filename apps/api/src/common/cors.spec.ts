import { corsOptionsFor } from './cors';

const allowed = {
  dashboardUrl: 'http://localhost:3000',
  widgetUrl: 'http://localhost:3002',
};

describe('corsOptionsFor', () => {
  it('lets the dashboard call every route with its cookie', () => {
    for (const url of ['/v1/auth/me', '/v1/public/chatbots/x/config']) {
      expect(corsOptionsFor(allowed.dashboardUrl, url, allowed)).toEqual({
        origin: true,
        credentials: true,
      });
    }
  });

  it('lets the widget call the public chat API without cookies', () => {
    expect(
      corsOptionsFor(
        allowed.widgetUrl,
        '/v1/public/conversations/c1/messages',
        allowed,
      ),
    ).toEqual({ origin: true, credentials: false });
  });

  it('keeps the widget out of the dashboard API', () => {
    for (const url of ['/v1/auth/me', '/v1/chatbot', '/v1/publicity']) {
      expect(corsOptionsFor(allowed.widgetUrl, url, allowed)).toEqual({
        origin: false,
      });
    }
  });

  it('gives any other origin no CORS headers', () => {
    expect(
      corsOptionsFor(
        'https://evil.example',
        '/v1/public/chatbots/x/config',
        allowed,
      ),
    ).toEqual({ origin: false });
    expect(
      corsOptionsFor(undefined, '/v1/public/chatbots/x/config', allowed),
    ).toEqual({ origin: false });
  });
});
