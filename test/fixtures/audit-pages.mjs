// Entirely synthetic account/application data. Never copy an account page here.
export const googleAccount = '<button aria-label="Google Account: Audit (Audit@EXAMPLE.test)"></button>';
export function auditPage(service, count = 1) {
  const rows = Array.from({length:count}, (_, i) => i);
  if (service === 'google-connections') return `${googleAccount}<main><h1>Your connections to third-party apps &amp; services</h1><section><h2>Sign in with Google</h2><ul aria-label="Sign in with Google">${rows.map(i=>`<li><h3>Fixture ${i}</h3></li>`).join('')}</ul></section></main>`;
  if (service === 'google-cloud-projects') return `${googleAccount}<main><table><thead><tr><th>Project name</th><th>Project ID</th><th>Status</th></tr></thead><tbody>${rows.map(i=>`<tr><td>Fixture ${i}</td><td>fixture-${i}</td><td>Active</td></tr>`).join('')}</tbody></table></main>`;
  if (service === 'x-connected-apps') return `<button data-testid="SideNav_AccountSwitcher_Button"><span>@QLyun35332</span></button><main><h1>Connected apps</h1><ul aria-label="Connected apps">${rows.map(i=>`<li><a href="/settings/connected_apps/${i+1}"><span dir="auto">Fixture ${i}</span></a></li>`).join('')}</ul></main>`;
  return `<main><h1>Applications</h1><ul aria-label="Applications">${rows.map(i=>`<li><a href="/developers/applications/123456789012345${String(i).padStart(3,'0')}/information"><h3>Fixture ${i}</h3></a></li>`).join('')}</ul></main>`;
}

// Synthetic examples of the current semantic/structural variants. Labels are
// public UI fields; identities, IDs, and names are entirely fabricated.
export function auditCurrentPage(service) {
  if(service==='google-connections')return `${googleAccount}<div role="main" hidden><ul><li>Hidden menu</li></ul></div><c-wiz><h1>リンク済みアプリ</h1><div><a href="linkedapps/detail/fixture"><span></span><div><div><img alt=""></div><div><div><div>Fixture 0</div></div></div></div></a></div></c-wiz>`;
  if(service==='google-cloud-projects')return `<cfc-account-chooser><button aria-label="Account: Audit@EXAMPLE.test"></button></cfc-account-chooser><main><table role="treegrid"><thead><tr role="row"><td></td><td role="columnheader">名前</td><td role="columnheader">ID</td><td role="columnheader">ステータス</td></tr></thead><tbody><tr><td></td><td>組織なし</td><td></td><td></td></tr><tr><td></td><td>Fixture 0</td><td>fixture-0</td><td>Active</td></tr><tr><td></td><td>Fixture folder</td><td>123456</td><td></td></tr></tbody></table></main>`;
  if(service==='x-connected-apps')return `<button data-testid="SideNav_AccountSwitcher_Button"><span>@QLyun35332</span></button><main><h2>Connected apps</h2><section><a href="/settings/connected_apps/1"><div><div><img alt=""></div><div><div><span>Fixture 0</span></div></div><svg></svg></div></a></section></main>`;
  return `<main><h1>アプリケーション<button>新しいアプリケーション</button></h1><div><a href="/developers/applications/123456789012345678/information"><div><div></div><abbr><div>Fixture 0</div></abbr></div></a></div></main>`;
}

// Synthetic tree expansion only; Delete must never be invoked by an audit.
export function cloudCollapsedPage({ambiguous=false,expanded=false}={}) {
 return `${googleAccount}<main><table role="treegrid"><thead><tr><th></th><th>Name</th><th>ID</th><th>Status</th></tr></thead><tbody><tr aria-expanded="${expanded}"><td><button type="button" aria-label="Expand this row" aria-expanded="${expanded}" id="fixture-expand"></button>${ambiguous?'<button type="button" aria-label="Expand this row" aria-expanded="false" id="fixture-other-expand"></button>':''}</td><td>No organization</td><td></td><td><button type="button" aria-label="Delete" aria-haspopup="menu" aria-expanded="false" id="fixture-delete">Delete</button></td></tr>${expanded?'<tr><td></td><td>Fixture project</td><td>fixture-0</td><td>Active</td></tr>':''}</tbody></table></main>`;
}
