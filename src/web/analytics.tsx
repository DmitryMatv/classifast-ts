/**
 * The only inline script any page runs. The Content-Security-Policy allows
 * it by its SHA-256 hash (`SECURITY_HEADERS`), so any edit to this text,
 * whitespace included, changes the hash with it.
 */
export const GTAG_SCRIPT = `
        window.dataLayer = window.dataLayer || [];
        function gtag() { dataLayer.push(arguments); }
        gtag('js', new Date());

        gtag('config', 'G-JK3ESE6CJR');
    `;

export function GoogleAnalytics() {
  return (
    <>
      <script
        async
        src="https://www.googletagmanager.com/gtag/js?id=G-JK3ESE6CJR"
      ></script>
      <script dangerouslySetInnerHTML={{ __html: GTAG_SCRIPT }} />
    </>
  );
}
