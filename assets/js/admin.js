import { request, status, message, takeLinkToken, withSubmit } from './api.js';
(async () => {
const find = selector => document.querySelector(selector);
const feedback = find('[data-admin-status]');
const login = find('[data-admin-login]');
const dashboard = find('[data-admin-dashboard]');
const settingsForm = find('[data-settings]');
const key = 'chile-drop-admin-session';
let session = sessionStorage.getItem(key) || '';
let snapshot, offset = 0;
const token = takeLinkToken();
function signout() {sessionStorage.removeItem(key);session='';snapshot=null;dashboard.hidden=true;login.hidden=false;}
function stat(label, value) {const box=document.createElement('div');box.className='dashboard-stat';const number=document.createElement('strong');number.textContent=value;const text=document.createElement('span');text.textContent=label;box.append(number,text);return box;}
function render(data) {
  snapshot=data; dashboard.hidden=false;login.hidden=true;
  find('[data-stats]').replaceChildren(stat('Verified groups',data.counts.verifiedOrders),stat('Guests in verified groups',data.counts.verifiedPeople),stat('Total groups',data.counts.totalOrders));
  settingsForm.elements.capacity.value=data.settings.capacity;
  settingsForm.elements.registrationOpen.checked=data.settings.registrationOpen;
  for(const control of settingsForm.elements) control.disabled=data.settings.locked;
  find('[data-settings-note]').textContent=data.settings.locked?'The drawing has been prepared. Entry and capacity are locked.':'Open or close entry here. The drawing is always manual.';
  find('[data-preview]').disabled=data.settings.registrationOpen||Boolean(data.drawing);
  find('[data-preview]').textContent=data.preview?'Review fixed drawing':'Prepare drawing';
  find('[data-draw-consent]').hidden=Boolean(data.preview)||Boolean(data.drawing);
  find('[data-commit]').disabled=!data.preview||Boolean(data.drawing);
  find('[data-publish]').disabled=!data.drawing||Boolean(data.drawing.publishedAt);
  find('[data-publish-consent]').hidden=!data.drawing||Boolean(data.drawing.publishedAt);
  const summary=find('[data-draw-summary]');
  summary.hidden=!data.preview;
  if(data.preview){const p=data.preview;summary.textContent=`${p.selectedOrders} selected groups / ${p.selectedPeople} guests. ${p.waitlistedOrders} groups waitlisted. ${p.unusedCapacity} spaces unfilled. ${data.drawing?(data.drawing.publishedAt?'Results published.':'Result committed; emails have not been published.'):'Random order is fixed. Review before committing.'}`;}
  const body=find('[data-entries]');body.replaceChildren();
  for(const entry of data.entries){const row=document.createElement('tr');for(const value of [entry.name,entry.email,entry.groupSize,entry.status.replaceAll('_',' ')]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}body.append(row);}
  find('[data-pagination]').textContent=data.total?`${offset+1}–${Math.min(offset+data.entries.length,data.total)} of ${data.total} groups`:'No entries yet.';
  find('[data-previous]').disabled=offset===0;
  find('[data-next]').disabled=offset+50>=data.total;
  find('[data-email-summary]').textContent=`Email outbox: ${JSON.stringify(data.outbox)}. Weekly activity reports go to the configured organizer address on Mondays.`;
}
async function refresh(){try{render(await request(`/api/admin/entries?limit=50&offset=${offset}`,{},session));}catch(error){if(error.status===401)signout();throw error;}}
async function action(button,run){button.disabled=true;try{await run();await refresh();}catch(error){status(feedback,message(error),'error');feedback.focus();}finally{if(snapshot)render(snapshot);else button.disabled=false;}}
if(token){status(feedback,'Confirming organizer sign-in…');try{const data=await request('/api/admin/verify',{method:'POST',body:{token}});session=data.accessToken;sessionStorage.setItem(key,session);await refresh();status(feedback,'Signed in. No drawing or email publication happens automatically.','success');}catch(error){signout();status(feedback,message(error),'error');}}
else if(session){try{await refresh();}catch(error){status(feedback,message(error),'error');}}
login.addEventListener('submit',event=>{event.preventDefault();withSubmit(login,async()=>{try{await request('/api/admin/login',{method:'POST',body:{email:login.elements.email.value}});status(feedback,'If this is an authorized organizer email, a sign-in link will arrive shortly.','success');}catch(error){status(feedback,message(error),'error');}});});
settingsForm.addEventListener('submit',event=>{event.preventDefault();withSubmit(settingsForm,async()=>{try{await request('/api/admin/settings',{method:'PATCH',body:{registrationOpen:settingsForm.elements.registrationOpen.checked,capacity:Number(settingsForm.elements.capacity.value)}},session);await refresh();status(feedback,'Registration settings saved.','success');}catch(error){status(feedback,message(error),'error');}});});
find('[data-refresh]').addEventListener('click',event=>action(event.currentTarget,async()=>{status(feedback,'Entry list refreshed.','success');}));
find('[data-admin-signout]').addEventListener('click',()=>{signout();status(feedback,'Signed out.');});
find('[data-preview]').addEventListener('click',event=>action(event.currentTarget,async()=>{if(!snapshot.preview&&!find('[data-confirm-draw]').checked)throw new Error('Confirm that you understand preparing locks the drawing.');await request('/api/admin/draw/preview',{method:'POST',body:{}},session);status(feedback,'Random order prepared. Review the group and guest totals before committing.','success');}));
find('[data-commit]').addEventListener('click',event=>action(event.currentTarget,async()=>{await request('/api/admin/draw/commit',{method:'POST',body:{previewId:snapshot.preview.previewId}},session);status(feedback,'Drawing committed. Results are not yet published.','success');}));
find('[data-publish]').addEventListener('click',event=>action(event.currentTarget,async()=>{if(!find('[data-confirm-publish]').checked)throw new Error('Confirm that you have reviewed the result and are ready to email guests.');await request('/api/admin/draw/publish',{method:'POST',body:{}},session);status(feedback,'Results published and notification emails queued for delivery.','success');}));
find('[data-export]').addEventListener('click',event=>action(event.currentTarget,async()=>{const csv=await request('/api/admin/entries.csv',{},session);const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='chile-drop-entries.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status(feedback,'Private guest CSV exported. Store it securely.','success');}));
find('[data-previous]').addEventListener('click',event=>action(event.currentTarget,async()=>{offset=Math.max(0,offset-50);}));
find('[data-next]').addEventListener('click',event=>action(event.currentTarget,async()=>{offset+=50;}));

})();
