// Entirely synthetic account/application data. Never copy an account page here.
export const googleAccount = '<button aria-label="Google Account: Audit (Audit@EXAMPLE.test)"></button>';
export function auditPage(service, count = 1) {
  const rows = Array.from({length:count}, (_, i) => i);
  if (service === 'google-connections') return `${googleAccount}<main><h1>Your connections to third-party apps &amp; services</h1><section><h2>Sign in with Google</h2><ul aria-label="Sign in with Google">${rows.map(i=>`<li><h3>Fixture ${i}</h3></li>`).join('')}</ul></section></main>`;
  if (service === 'google-cloud-projects') return `${googleAccount}<main><table><thead><tr><th>Project name</th><th>Project ID</th><th>Status</th></tr></thead><tbody>${rows.map(i=>`<tr><td>Fixture ${i}</td><td>fixture-${i}</td><td>Active</td></tr>`).join('')}</tbody></table></main>`;
  if (service === 'x-connected-apps') return `<button data-testid="SideNav_AccountSwitcher_Button"><span>@QLyun35332</span></button><main><h1>Connected apps</h1><ul aria-label="Connected apps">${rows.map(i=>`<li><a href="/settings/connected_apps/${i+1}"><span dir="auto">Fixture ${i}</span></a></li>`).join('')}</ul></main>`;
  return `<main><h1>Applications</h1><ul aria-label="Applications">${rows.map(i=>`<li><a href="/developers/applications/123456789012345${String(i).padStart(3,'0')}/information"><h3>Fixture ${i}</h3></a></li>`).join('')}</ul></main>`;
}
