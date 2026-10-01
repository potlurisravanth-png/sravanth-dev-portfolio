/* ============================================================================
   contact.js: the "Get in touch" form. Two delivery paths, both honest about
   what happened.

   1. Formspree (or any endpoint that accepts a form POST and answers JSON):
      put the endpoint in the form's action, e.g.
        <form ... action="https://formspree.io/f/your-form-id" method="post">
      The message is sent in the background and the status line says whether
      it arrived. Without JavaScript the same action still works as a plain post.

   2. No endpoint (action="mailto:..."): the visitor's email app opens with the
      message already written. Nothing is sent until they press send there.
   ========================================================================== */
(function () {
  'use strict';
  var form = document.getElementById('contact-form');
  if (!form) return;
  var status = form.querySelector('.form__status');
  var button = form.querySelector('button[type="submit"]');

  function say(state, msg) {
    status.setAttribute('data-state', state);
    status.textContent = msg;
  }

  form.addEventListener('submit', function (e) {
    if (!form.checkValidity()) return;   // let the browser explain what is missing
    e.preventDefault();
    var action = (form.getAttribute('action') || '').trim();
    var data = new FormData(form);
    var name = (data.get('name') || '').toString().trim();
    var email = (data.get('email') || '').toString().trim();
    var company = (data.get('company') || '').toString().trim();
    var message = (data.get('message') || '').toString().trim();

    if (/^https:\/\//i.test(action)) {
      button.disabled = true;
      say('busy', 'Sending…');
      fetch(action, { method: 'POST', body: data, headers: { Accept: 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); })
        .then(function () {
          form.reset();
          say('ok', 'Sent. Thank you, your message is on its way.');
        })
        .catch(function () {
          say('err', 'That did not go through. The Email button below opens your email app instead.');
        })
        .then(function () { button.disabled = false; });
      return;
    }

    var to = action.replace(/^mailto:/i, '');
    var subject = 'Portfolio: a note from ' + name + (company ? ' (' + company + ')' : '');
    var body = message + '\n\n' + name + '\n' + email + (company ? '\n' + company : '');
    location.href = 'mailto:' + to + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    say('ok', 'Your email app should open with the message written. Press send there to deliver it.');
  });
})();
