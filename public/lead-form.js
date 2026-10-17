/* lead-form.js — renders the marketing-site intake form into any element with
 * a data-lead-form attribute, and posts it to /api/leads.
 *
 *   <div data-lead-form data-source="homepage" data-theme="dark"></div>
 *   <script src="/lead-form.js" defer></script>
 *
 * The option lists below must match LEAD_VERSIONS / LEAD_CHALLENGES in
 * lib/leads.ts — tests/leads.test.ts checks they stay in step.
 */
(function () {
  var VERSIONS = [
    'Navision 4.0 / 5.0 (Classic)',
    'NAV 2009 / 2009 R2',
    'NAV 2013 / 2013 R2',
    'NAV 2015',
    'NAV 2016',
    'NAV 2017',
    'NAV 2018',
    'Business Central 13 / 14 (on-premises)',
    'Business Central 15+ (on-premises)',
    'Not sure',
  ];
  var CHALLENGES = [
    'Finance reporting and month-end',
    'Getting answers out of NAV without IT',
    'NAV end of support / staying on NAV',
    'Planning an upgrade to Business Central',
    'Customisation needed or broken',
    'Our partner no longer supports our NAV',
    'Something else',
  ];

  var CSS =
    '.lf{display:grid;grid-template-columns:1fr 1fr;gap:1rem;font-family:"DM Sans",sans-serif}' +
    '.lf .full{grid-column:1/-1}' +
    '.lf label{display:block;font-family:"DM Mono",monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:.4rem;color:var(--lf-label)}' +
    '.lf input,.lf select,.lf textarea{width:100%;font:inherit;font-size:14px;padding:.75rem .9rem;border-radius:8px;border:1px solid var(--lf-border);background:var(--lf-field);color:var(--lf-text)}' +
    '.lf textarea{min-height:96px;resize:vertical}' +
    '.lf input:focus,.lf select:focus,.lf textarea:focus{outline:2px solid #1A9272;outline-offset:1px}' +
    '.lf .hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}' +
    '.lf button{justify-self:start;background:#0A5C46;color:#F4EFE4;font:inherit;font-size:14px;font-weight:500;padding:.9rem 2rem;border-radius:8px;border:1px solid rgba(244,239,228,.1);cursor:pointer}' +
    '.lf button:hover{background:#0F6E56}.lf button[disabled]{opacity:.6;cursor:wait}' +
    '.lf .msg{font-size:14px;line-height:1.6;color:var(--lf-text)}.lf .msg.err{color:#C0563B}' +
    '.lf .note{font-size:12px;color:var(--lf-label)}' +
    '.lf-done{font-size:15px;line-height:1.8;color:var(--lf-text);padding:1.5rem;border:1px solid var(--lf-border);border-radius:12px;background:var(--lf-field)}' +
    '[data-lead-form][data-theme=dark]{--lf-label:rgba(244,239,228,.65);--lf-border:rgba(244,239,228,.14);--lf-field:rgba(244,239,228,.04);--lf-text:#F4EFE4}' +
    '[data-lead-form]{--lf-label:#3B5249;--lf-border:#D6D9D4;--lf-field:#FAFAF8;--lf-text:#040E09}' +
    '[data-lead-form] select option{color:#040E09}' +
    '@media(max-width:640px){.lf{grid-template-columns:1fr}}';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function options(list) {
    var html = '<option value="">Select…</option>';
    for (var i = 0; i < list.length; i++) html += '<option>' + esc(list[i]) + '</option>';
    return html;
  }

  function field(id, label, control, full) {
    return '<div' + (full ? ' class="full"' : '') + '><label for="' + id + '">' + label + '</label>' + control + '</div>';
  }

  function render(host, n) {
    var p = 'lf' + n + '-';
    host.innerHTML =
      '<form class="lf" novalidate>' +
      field(p + 'name', 'Your name *', '<input id="' + p + 'name" name="name" autocomplete="name" required maxlength="120">') +
      field(p + 'email', 'Work email *', '<input id="' + p + 'email" name="email" type="email" autocomplete="email" required maxlength="254">') +
      field(p + 'company', 'Company', '<input id="' + p + 'company" name="company" autocomplete="organization" maxlength="160">') +
      field(p + 'ver', 'NAV / BC version', '<select id="' + p + 'ver" name="navVersion">' + options(VERSIONS) + '</select>') +
      field(p + 'ch', 'What would help most?', '<select id="' + p + 'ch" name="challenge">' + options(CHALLENGES) + '</select>', true) +
      field(p + 'msg', 'Anything else? (optional)', '<textarea id="' + p + 'msg" name="message" maxlength="2000"></textarea>', true) +
      '<div class="hp" aria-hidden="true"><label for="' + p + 'web">Website</label><input id="' + p + 'web" name="website" tabindex="-1" autocomplete="off"></div>' +
      '<div class="full msg" role="status" aria-live="polite"></div>' +
      '<div class="full"><button type="submit">Send</button></div>' +
      '<p class="full note">We reply from a real person, usually within one NZ business day. No mailing list.</p>' +
      '</form>';

    var form = host.querySelector('form');
    var status = form.querySelector('.msg');
    var button = form.querySelector('button');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = { source: host.getAttribute('data-source') || 'homepage' };
      var els = form.elements;
      for (var i = 0; i < els.length; i++) if (els[i].name) data[els[i].name] = els[i].value;

      status.className = 'full msg';
      if (!data.name.trim() || !data.email.trim()) {
        status.className = 'full msg err';
        status.textContent = 'Please add your name and work email.';
        return;
      }

      button.disabled = true;
      button.textContent = 'Sending…';
      fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, body: j }; });
        })
        .then(function (res) {
          if (res.ok) {
            host.innerHTML = '<div class="lf-done" role="status">Thanks, ' + esc(data.name.trim().split(' ')[0]) +
              '. We’ve got your details and will be in touch shortly.</div>';
            return;
          }
          throw new Error(res.body && res.body.error ? res.body.error : 'Something went wrong. Please try again.');
        })
        .catch(function (err) {
          status.className = 'full msg err';
          status.textContent = err && err.message && err.message !== 'Failed to fetch'
            ? err.message
            : 'We couldn’t reach the server. Please try again, or email Admin@bespoxai.com.';
          button.disabled = false;
          button.textContent = 'Send';
        });
    });
  }

  function init() {
    var hosts = document.querySelectorAll('[data-lead-form]');
    if (!hosts.length) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    for (var i = 0; i < hosts.length; i++) render(hosts[i], i);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
