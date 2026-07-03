/* Shared EN/Kannada toggle used by every static directory page (maha.html,
   mandal.html, outreach.html, prabhari.html, prabhari-pramukh.html, sir.html).
   Include with <script src="i18n.js"></script> before a page's own <script>. */
(function(){
  var KEY = 'mandalLang';
  function getLang(){ try{ return localStorage.getItem(KEY) || 'en'; }catch(e){ return 'en'; } }
  function setLang(l){ try{ localStorage.setItem(KEY, l); }catch(e){} }

  var I18N = { lang: getLang() };

  // Inline dynamic strings: L('English','ಕನ್ನಡ')
  I18N.L = function(en, kn){ return I18N.lang === 'kn' ? kn : en; };

  // "YYYY-MM-DD" -> "2 July 2026" (or Kannada month names in kn mode)
  var MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var MONTHS_KN = ['ಜನವರಿ','ಫೆಬ್ರವರಿ','ಮಾರ್ಚ್','ಏಪ್ರಿಲ್','ಮೇ','ಜೂನ್','ಜುಲೈ','ಆಗಸ್ಟ್','ಸೆಪ್ಟೆಂಬರ್','ಅಕ್ಟೋಬರ್','ನವೆಂಬರ್','ಡಿಸೆಂಬರ್'];
  I18N.fmtDate = function(d){
    if(!d) return d;
    var p = String(d).split('-');
    if(p.length !== 3) return d;
    var mi = parseInt(p[1], 10) - 1;
    var months = I18N.lang === 'kn' ? MONTHS_KN : MONTHS_EN;
    var mName = months[mi] || p[1];
    return parseInt(p[2], 10) + ' ' + mName + ' ' + p[0];
  };

  // Static markup: <span data-en="Search" data-kn="ಹುಡುಕಿ">Search</span>
  // <input data-en-ph="Search…" data-kn-ph="ಹುಡುಕಿ…">
  I18N.applyStatic = function(root){
    root = root || document;
    root.querySelectorAll('[data-en]').forEach(function(el){
      var kn = el.getAttribute('data-kn');
      el.textContent = (I18N.lang === 'kn' && kn != null) ? kn : el.getAttribute('data-en');
    });
    root.querySelectorAll('[data-en-ph]').forEach(function(el){
      var kn = el.getAttribute('data-kn-ph');
      el.placeholder = (I18N.lang === 'kn' && kn != null) ? kn : el.getAttribute('data-en-ph');
    });
    // For text that must keep nested markup (e.g. a <b> counter): data-en-html/data-kn-html
    root.querySelectorAll('[data-en-html]').forEach(function(el){
      var kn = el.getAttribute('data-kn-html');
      el.innerHTML = (I18N.lang === 'kn' && kn != null) ? kn : el.getAttribute('data-en-html');
    });
  };

  // Wires a toggle button; onChange(lang) runs after both the language flips
  // and applyStatic() re-paints, so a page can re-run its own dynamic render.
  I18N.mountToggle = function(btnId, onChange){
    var btn = document.getElementById(btnId);
    if(!btn) return;
    function paint(){
      btn.textContent = I18N.lang === 'kn' ? 'English' : 'ಕನ್ನಡ';
      btn.setAttribute('aria-label', I18N.lang === 'kn' ? 'Switch to English' : 'ಕನ್ನಡಕ್ಕೆ ಬದಲಿಸಿ');
    }
    paint();
    btn.addEventListener('click', function(){
      I18N.lang = I18N.lang === 'kn' ? 'en' : 'kn';
      setLang(I18N.lang);
      paint();
      I18N.applyStatic();
      if(typeof onChange === 'function') onChange(I18N.lang);
    });
  };

  window.I18N = I18N;
})();
