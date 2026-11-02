/** A script's English, found on the screen in the film's language (ui.ts). */

describe("a script's English in another language", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('finds a library item by the name the screen shows it with', async () => {
    vi.stubEnv('TUTORIAL_LANGUAGE', 'pt');
    vi.resetModules();
    const { inUi } = await import('./ui');
    const finds = (english: string | RegExp, shown: string) => {
      const r = inUi(english);
      return typeof r === 'string' ? r === shown : r.test(shown);
    };
    expect(finds('Standard Bible Flow', 'Fluxo bíblico padrão')).toBe(true);
    // A numbering by the name before " · ", as its list shows it.
    expect(finds('Like most English Bibles', 'Como a maioria das Bíblias em inglês')).toBe(true);
    expect(finds(/^Like most English Bibles/, 'Como a maioria das Bíblias em inglês · 66 livros')).toBe(true);
    // A name the app's own words have too, either way.
    expect(finds('FIA passages', 'Passagens da FIA')).toBe(true);
    expect(finds('FIA passages', 'Passagens do FIA')).toBe(true);
  });
});
