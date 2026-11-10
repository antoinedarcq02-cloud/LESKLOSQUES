const menuToggle=document.getElementById('menuToggle');
const nav=document.getElementById('mainNav');
menuToggle.addEventListener('click',()=>{const open=nav.classList.toggle('open');menuToggle.setAttribute('aria-expanded',String(open));});
nav.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>{nav.classList.remove('open');menuToggle.setAttribute('aria-expanded','false');}));
document.getElementById('year').textContent=new Date().getFullYear();
document.querySelectorAll('[data-package]').forEach(link=>link.addEventListener('click',()=>{document.querySelector('select[name="package"]').value=link.dataset.package;}));
document.getElementById('bookingForm').addEventListener('submit',event=>{
 event.preventDefault();const form=new FormData(event.currentTarget);
 const fields=[['Nom / organisation',form.get('name')],['Email',form.get('email')],['Téléphone',form.get('phone')],['Lieu',form.get('location')],['Date souhaitée',form.get('date')],['Formule',form.get('package')],['Message',form.get('message')]];
 const body=fields.map(([label,value])=>`${label} : ${value||'Non renseigné'}`).join('\n');
 document.getElementById('formStatus').textContent='Votre messagerie va s’ouvrir avec votre demande préremplie.';
 window.location.href=`mailto:antoine.darcq@laposte.net?subject=${encodeURIComponent('Demande de réservation - Les Klosques')}&body=${encodeURIComponent(body)}`;
});
