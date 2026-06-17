const frameAncestors = require('./frameAncestors');

describe('frameAncestors middleware', () => {
  const ORIGINAL = process.env.OUTERSCORE_FRAME_ANCESTORS;

  const invoke = () => {
    const headers = {};
    const res = {
      setHeader: (key, value) => {
        headers[key] = value;
      },
    };
    const next = jest.fn();
    frameAncestors({}, res, next);
    return { headers, next };
  };

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.OUTERSCORE_FRAME_ANCESTORS;
    } else {
      process.env.OUTERSCORE_FRAME_ANCESTORS = ORIGINAL;
    }
  });

  it('sets the CSP frame-ancestors header when configured with a quoted keyword', () => {
    process.env.OUTERSCORE_FRAME_ANCESTORS = "'self'";
    const { headers, next } = invoke();
    expect(headers['Content-Security-Policy']).toBe("frame-ancestors 'self'");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('quotes a bare `self` keyword so a =self misconfig is still enforced', () => {
    process.env.OUTERSCORE_FRAME_ANCESTORS = 'self';
    const { headers } = invoke();
    expect(headers['Content-Security-Policy']).toBe("frame-ancestors 'self'");
  });

  it('passes an explicit origin list through unchanged', () => {
    process.env.OUTERSCORE_FRAME_ANCESTORS =
      'https://app.outerscore.com https://test.outerscore.com';
    const { headers } = invoke();
    expect(headers['Content-Security-Policy']).toBe(
      'frame-ancestors https://app.outerscore.com https://test.outerscore.com',
    );
  });

  it('emits no header when unset', () => {
    delete process.env.OUTERSCORE_FRAME_ANCESTORS;
    const { headers, next } = invoke();
    expect(headers['Content-Security-Policy']).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('treats a whitespace-only value as unset', () => {
    process.env.OUTERSCORE_FRAME_ANCESTORS = '   ';
    const { headers } = invoke();
    expect(headers['Content-Security-Policy']).toBeUndefined();
  });
});
