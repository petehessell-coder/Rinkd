// Rinkd Survey Component
import React, { useState, useEffect } from 'react';

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxm4Yz7h4OK-2xMb-dt6E87cvAPVfNExjFJbLc96QQv0uZ4bRqjIFvT7wDlWhuxWPRGVg/exec';

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,400;0,600;0,700;0,900;1,900&family=Barlow:wght@400;500;600&display=swap');

  .sv-root {
    --navy: #0B1F3A;
    --blue: #2E5B8C;
    --red: #D72638;
    --ice: #F4F7FA;
    --steel: #8BA3BE;
    --dark: #07111F;
    --card: #112236;
    --border: #1E3A5C;
    --white: #FFFFFF;
    background: var(--dark);
    color: var(--white);
    font-family: 'Barlow', sans-serif;
    font-size: 16px;
    line-height: 1.5;
    min-height: 100vh;
    position: relative;
  }
  .sv-root::before {
    content: '';
    position: fixed;
    inset: 0;
    background: repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.04) 2px,rgba(0,0,0,0.04) 4px);
    pointer-events: none;
    z-index: 1000;
  }
  .sv-header {
    background: var(--navy);
    border-bottom: 3px solid var(--red);
    padding: 20px 24px;
    text-align: center;
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .sv-logo-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    margin-bottom: 4px;
  }
  .sv-led-logo {
    width: 56px;
    height: 56px;
    background: #06101e;
    border: 2px solid #1a2f4a;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 20px rgba(215,38,56,0.35), inset 0 0 12px rgba(0,0,0,0.6);
    flex-shrink: 0;
  }
  .sv-brand-name {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-style: italic;
    font-size: 32px;
    letter-spacing: 0.06em;
    color: #fff;
    line-height: 1;
  }
  .sv-brand-sub {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.18em;
    color: var(--steel);
    text-transform: uppercase;
  }
  .sv-progress-wrap {
    background: var(--navy);
    padding: 14px 24px;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 97px;
    z-index: 99;
  }
  .sv-progress-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .sv-progress-label {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: var(--steel);
    text-transform: uppercase;
  }
  .sv-progress-pct {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 16px;
    color: var(--red);
  }
  .sv-progress-track {
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }
  .sv-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--blue), var(--red));
    border-radius: 2px;
    transition: width 0.4s ease;
  }
  .sv-hero {
    background: linear-gradient(180deg, var(--navy) 0%, var(--dark) 100%);
    padding: 48px 24px 40px;
    text-align: center;
    border-bottom: 1px solid var(--border);
  }
  .sv-hero-eyebrow {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.2em;
    color: var(--red);
    text-transform: uppercase;
    margin-bottom: 12px;
  }
  .sv-hero h1 {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-style: italic;
    font-size: clamp(36px, 6vw, 56px);
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    margin-bottom: 16px;
  }
  .sv-hero h1 span { color: var(--red); }
  .sv-hero p {
    max-width: 520px;
    margin: 0 auto 24px;
    color: var(--steel);
    font-size: 15px;
    line-height: 1.6;
  }
  .sv-hero-tags { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  .sv-hero-tag {
    background: var(--card);
    border: 1px solid var(--border);
    color: var(--steel);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    padding: 5px 12px;
    border-radius: 20px;
    text-transform: uppercase;
  }
  .sv-container { max-width: 680px; margin: 0 auto; padding: 0 16px 60px; }
  .sv-section-header { padding: 40px 0 20px; border-bottom: 1px solid var(--border); margin-bottom: 8px; }
  .sv-section-number {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.2em;
    color: var(--red);
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .sv-section-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-style: italic;
    font-size: 28px;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    line-height: 1;
  }
  .sv-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 22px 20px;
    margin: 10px 0;
    transition: border-color 0.2s ease;
  }
  .sv-card.sv-error { border-color: #ff6b6b; }
  .sv-card-highlight {
    border-color: var(--blue);
    background: linear-gradient(135deg, #112236 0%, #0d1f35 100%);
  }
  .sv-q-label { font-size: 15px; font-weight: 600; color: var(--white); margin-bottom: 14px; line-height: 1.4; }
  .sv-q-num {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    color: var(--red);
    font-size: 12px;
    letter-spacing: 0.1em;
    display: block;
    margin-bottom: 4px;
    text-transform: uppercase;
  }
  .sv-q-num-blue { color: #60A5FA !important; }
  .sv-options { display: flex; flex-direction: column; gap: 8px; }
  .sv-options-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .sv-option {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--navy);
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 11px 14px;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
  }
  .sv-option:hover { border-color: var(--blue); background: rgba(46,91,140,0.15); }
  .sv-option.sv-selected { border-color: var(--red); background: rgba(215,38,56,0.1); }
  .sv-dot {
    width: 18px; height: 18px;
    border: 2px solid var(--border);
    border-radius: 50%;
    flex-shrink: 0;
    transition: all 0.15s ease;
  }
  .sv-option.sv-selected .sv-dot { border-color: var(--red); background: var(--red); box-shadow: 0 0 8px rgba(215,38,56,0.5); }
  .sv-check {
    width: 18px; height: 18px;
    border: 2px solid var(--border);
    border-radius: 4px;
    flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s ease;
    font-size: 11px;
  }
  .sv-option.sv-selected .sv-check { border-color: var(--red); background: var(--red); box-shadow: 0 0 8px rgba(215,38,56,0.5); color: white; font-weight: 700; }
  .sv-opt-text { font-size: 14px; color: var(--steel); transition: color 0.15s ease; }
  .sv-option.sv-selected .sv-opt-text { color: var(--white); }
  .sv-scale-row { display: flex; gap: 6px; align-items: center; }
  .sv-scale-btn {
    flex: 1; padding: 10px 4px;
    background: var(--navy);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--steel);
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700; font-size: 15px;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: center;
  }
  .sv-scale-btn:hover { border-color: var(--blue); color: var(--white); }
  .sv-scale-btn.sv-selected { border-color: var(--red); background: rgba(215,38,56,0.15); color: var(--white); box-shadow: 0 0 8px rgba(215,38,56,0.3); }
  .sv-scale-labels { display: flex; justify-content: space-between; font-size: 11px; color: var(--steel); margin-top: 4px; }
  .sv-likelihood-grid { display: flex; flex-direction: column; gap: 10px; }
  .sv-likelihood-row { display: flex; align-items: center; gap: 10px; }
  .sv-likelihood-label { font-size: 13px; color: var(--steel); width: 140px; flex-shrink: 0; line-height: 1.3; }
  .sv-likelihood-scale { display: flex; gap: 4px; flex: 1; }
  .sv-lbtn {
    flex: 1; padding: 8px 2px;
    background: var(--navy);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--steel);
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700; font-size: 13px;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: center;
  }
  .sv-lbtn:hover { border-color: var(--blue); }
  .sv-lbtn.sv-selected { border-color: var(--red); background: rgba(215,38,56,0.15); color: var(--white); }
  .sv-textarea {
    width: 100%;
    background: var(--navy);
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--white);
    font-family: 'Barlow', sans-serif;
    font-size: 14px;
    padding: 12px 14px;
    outline: none;
    transition: border-color 0.2s ease;
    resize: vertical;
  }
  .sv-textarea::placeholder { color: var(--steel); }
  .sv-textarea:focus { border-color: var(--blue); }
  .sv-input {
    width: 100%;
    background: var(--navy);
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--white);
    font-family: 'Barlow', sans-serif;
    font-size: 14px;
    padding: 12px 14px;
    outline: none;
    transition: border-color 0.2s ease;
    margin-bottom: 10px;
  }
  .sv-input::placeholder { color: var(--steel); }
  .sv-input:focus { border-color: var(--blue); }
  .sv-error-msg { font-size: 12px; color: #ff6b6b; margin-top: 8px; }
  .sv-req { color: var(--red); margin-left: 2px; }
  .sv-submit-section { padding: 32px 0 0; text-align: center; }
  .sv-submit-note { font-size: 13px; color: var(--steel); margin-bottom: 20px; }
  .sv-submit-btn {
    display: inline-block;
    background: var(--red);
    color: var(--white);
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900; font-style: italic;
    font-size: 20px; letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 16px 48px;
    border: none; border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 4px 20px rgba(215,38,56,0.4);
    width: 100%; max-width: 400px;
  }
  .sv-submit-btn:hover { background: #b51e2e; transform: translateY(-1px); }
  .sv-submit-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
  .sv-success {
    text-align: center;
    padding: 80px 24px;
  }
  .sv-success-icon { font-size: 56px; margin-bottom: 20px; }
  .sv-success h2 {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900; font-style: italic;
    font-size: 40px; text-transform: uppercase;
    margin-bottom: 12px;
  }
  .sv-success p { color: var(--steel); max-width: 400px; margin: 0 auto 28px; line-height: 1.6; }
  .sv-rinkd-link {
    display: inline-block;
    background: var(--blue); color: var(--white);
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900; font-style: italic;
    font-size: 18px; letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 14px 36px; border-radius: 8px;
    text-decoration: none;
    transition: background 0.2s;
  }
  .sv-rinkd-link:hover { background: #245070; }
  .sv-footer {
    background: var(--navy);
    border-top: 1px solid var(--border);
    padding: 24px; text-align: center;
    margin-top: 40px;
  }
  .sv-footer-brands { display: flex; gap: 16px; justify-content: center; margin-bottom: 10px; }
  .sv-footer-copy { font-size: 12px; color: var(--steel); }
  @media (max-width: 480px) {
    .sv-scale-btn { padding: 8px 2px; font-size: 13px; }
    .sv-likelihood-label { width: 110px; font-size: 12px; }
    .sv-lbtn { font-size: 12px; }
  }
`;

// ── SUB-COMPONENTS ─────────────────────────────────────────

function RadioGroup({ name, options, value, onChange, fullWidth }) {
  return (
    <div className={fullWidth ? 'sv-options' : 'sv-options'}>
      {options.map(opt => (
        <div
          key={opt}
          className={`sv-option${value === opt ? ' sv-selected' : ''}`}
          onClick={() => onChange(name, opt)}
        >
          <div className="sv-dot" />
          <span className="sv-opt-text">{opt}</span>
        </div>
      ))}
    </div>
  );
}

function RadioGrid({ name, options, value, onChange }) {
  return (
    <div className="sv-options-grid">
      {options.map(opt => (
        <div
          key={opt}
          className={`sv-option${value === opt ? ' sv-selected' : ''}`}
          onClick={() => onChange(name, opt)}
          style={opt.startsWith('N/A') ? { gridColumn: '1/-1' } : {}}
        >
          <div className="sv-dot" />
          <span className="sv-opt-text">{opt}</span>
        </div>
      ))}
    </div>
  );
}

function CheckGroup({ name, options, values, onChange }) {
  const toggle = (opt) => {
    const current = values || [];
    const next = current.includes(opt) ? current.filter(v => v !== opt) : [...current, opt];
    onChange(name, next);
  };
  return (
    <div className="sv-options">
      {options.map(opt => (
        <div
          key={opt}
          className={`sv-option${(values || []).includes(opt) ? ' sv-selected' : ''}`}
          onClick={() => toggle(opt)}
        >
          <div className="sv-check">{(values || []).includes(opt) ? '✓' : ''}</div>
          <span className="sv-opt-text">{opt}</span>
        </div>
      ))}
    </div>
  );
}

function Scale10({ name, value, onChange, labelLow, labelHigh }) {
  return (
    <div>
      <div className="sv-scale-row">
        {[1,2,3,4,5,6,7,8,9,10].map(n => (
          <button
            key={n} type="button"
            className={`sv-scale-btn${value === String(n) ? ' sv-selected' : ''}`}
            onClick={() => onChange(name, String(n))}
          >{n}</button>
        ))}
      </div>
      <div className="sv-scale-labels"><span>{labelLow}</span><span>{labelHigh}</span></div>
    </div>
  );
}

function LikelihoodRow({ label, name, value, onChange }) {
  return (
    <div className="sv-likelihood-row">
      <span className="sv-likelihood-label">{label}</span>
      <div className="sv-likelihood-scale">
        {[1,2,3,4,5].map(n => (
          <button
            key={n} type="button"
            className={`sv-lbtn${value === String(n) ? ' sv-selected' : ''}`}
            onClick={() => onChange(name, String(n))}
          >{n}</button>
        ))}
      </div>
    </div>
  );
}

function SectionHeader({ num, title }) {
  return (
    <div className="sv-section-header">
      <div className="sv-section-number">Section {num}</div>
      <div className="sv-section-title">{title}</div>
    </div>
  );
}

function QCard({ id, num, label, required, error, children, highlight }) {
  return (
    <div className={`sv-card${error ? ' sv-error' : ''}${highlight ? ' sv-card-highlight' : ''}`} id={id}>
      <div className="sv-q-label">
        <span className={`sv-q-num${highlight ? ' sv-q-num-blue' : ''}`}>{num}{required ? ' · Required' : ''}</span>
        {label}{required && <span className="sv-req">*</span>}
      </div>
      {children}
      {error && <div className="sv-error-msg">This field is required.</div>}
    </div>
  );
}

// ── MAIN COMPONENT ─────────────────────────────────────────

export default function Survey() {
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);

  const REQUIRED = ['q1','q2','q5','q7','q8','q9','q12','q19','q22'];

  useEffect(() => {
    const answered = REQUIRED.filter(q => answers[q] && answers[q] !== '').length;
    setProgress(Math.round((answered / REQUIRED.length) * 100));
  }, [answers]);

  const set = (name, value) => {
    setAnswers(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: false }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const newErrors = {};
    REQUIRED.forEach(q => {
      if (!answers[q] || answers[q] === '') newErrors[q] = true;
    });
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      const firstKey = Object.keys(newErrors)[0];
      document.getElementById(firstKey)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSubmitting(true);
    const data = { ...answers, submitted_at: new Date().toISOString(), source: 'rinkd.app/survey' };
    // Serialize checkbox arrays to strings
    ['q5b','q6','q10','q18'].forEach(k => {
      if (Array.isArray(data[k])) data[k] = data[k].join(', ');
    });
    try {
      await fetch(SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } catch (err) { /* no-cors means we can't read response — that's fine */ }
    setSubmitted(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (submitted) {
    return (
      <div className="sv-root">
        <style>{styles}</style>
        <div className="sv-container">
          <div className="sv-success">
            <div className="sv-success-icon">🏒</div>
            <h2>You're on the ice.</h2>
            <p>Thanks for taking the time. Your input directly shapes Rinkd. We'll reach out when we're ready to launch — go time is coming.</p>
            <a href="/feed" className="sv-rinkd-link">Back to Rinkd →</a>
          </div>
        </div>
        <footer className="sv-footer">
          <div className="sv-footer-brands">
            <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:12,letterSpacing:'0.12em',textTransform:'uppercase',color:'#fff'}}>RINKD</span>
            <span style={{color:'#1E3A5C'}}>·</span>
            <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:12,letterSpacing:'0.12em',textTransform:'uppercase',color:'#2E5B8C'}}>RINKSIDE</span>
            <span style={{color:'#1E3A5C'}}>·</span>
            <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:12,letterSpacing:'0.12em',textTransform:'uppercase',color:'#D72638'}}>CREASE</span>
          </div>
          <div className="sv-footer-copy">Pete@rinkd.app · rinkd.app · © 2026 Rinkd LLC</div>
        </footer>
      </div>
    );
  }

  return (
    <div className="sv-root">
      <style>{styles}</style>

      {/* HEADER */}
      <header className="sv-header">
        <div className="sv-logo-wrap">
          <div className="sv-led-logo">
            <svg viewBox="0 0 37 42" width="40" height="40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <filter id="ledglow2" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="1.2" result="blur"/>
                  <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
              </defs>
              {/* OFF dots */}
              {[4,9,14,19,24,29,34].map(x => [4,9,14,19,24,29,34,39].map(y => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="#1a3050"/>
              )))}
              {/* ON dots — R shape */}
              {[[4,4],[9,4],[14,4],[19,4],[24,4],[4,9],[29,9],[4,14],[29,14],[4,19],[9,19],[14,19],[19,19],[24,19],[4,24],[19,24],[4,29],[24,29],[4,34],[29,34],[4,39],[34,39]].map(([x,y]) => (
                <circle key={`on-${x}-${y}`} cx={x} cy={y} r="1.8" fill="#D72638" filter="url(#ledglow2)"/>
              ))}
            </svg>
          </div>
          <div>
            <div className="sv-brand-name">RINKD</div>
            <div className="sv-brand-sub">The Platform Built for Hockey</div>
          </div>
        </div>
      </header>

      {/* PROGRESS */}
      <div className="sv-progress-wrap">
        <div className="sv-progress-meta">
          <span className="sv-progress-label">Survey Progress</span>
          <span className="sv-progress-pct">{progress}%</span>
        </div>
        <div className="sv-progress-track">
          <div className="sv-progress-fill" style={{width: `${progress}%`}} />
        </div>
      </div>

      {/* HERO */}
      <div className="sv-hero">
        <div className="sv-hero-eyebrow">🏒 Community Survey · 2026</div>
        <h1>Help Us Build<br/><span>Your Platform.</span></h1>
        <p>Rinkd is being built for the hockey community — by someone who loves the game. Your input directly shapes the product. Takes about 5 minutes. No fluff.</p>
        <div className="sv-hero-tags">
          {['All Ages','All Levels','Beer League to Pro','100% Anonymous'].map(t => (
            <span key={t} className="sv-hero-tag">{t}</span>
          ))}
        </div>
      </div>

      <div className="sv-container">
        <form onSubmit={handleSubmit} noValidate>

          {/* ── SECTION 1 ── */}
          <SectionHeader num="01" title="About You" />

          <QCard id="q1" num="Q1" label="What best describes your role in hockey?" required error={errors.q1}>
            <RadioGroup name="q1" value={answers.q1} onChange={set} options={['Youth Player (under 18)','Adult / Beer League Player','Junior / College Player','Coach','Hockey Parent','Fan / Spectator','Official / Referee','Hockey Industry']} />
          </QCard>

          <QCard id="q2" num="Q2" label="What level do you primarily play or follow?" required error={errors.q2}>
            <RadioGroup name="q2" value={answers.q2} onChange={set} options={['Mite / Learn to Skate (U8)','Squirt / Peewee (U10–U12)','Bantam / Midget (U14–U18)','Junior (USHL / NAHL / Tier III)','College / University','Beer League / Adult Rec','Semi-Pro / Pro','Multiple / All levels']} />
          </QCard>

          <QCard id="q3" num="Q3" label="What's your position? (optional)">
            <RadioGrid name="q3" value={answers.q3} onChange={set} options={['Forward','Defense','Goalie','N/A – Coach','N/A – Fan / Parent']} />
          </QCard>

          <QCard id="q4" num="Q4" label="Where are you located?">
            <RadioGroup name="q4" value={answers.q4} onChange={set} options={['USA – Northeast','USA – Midwest','USA – South','USA – West','Canada','Europe / International']} />
          </QCard>

          {/* ── SECTION 2 ── */}
          <SectionHeader num="02" title="Hockey & Social Media" />

          <QCard id="q5" num="Q5" label="How often do you post hockey content on social media?" required error={errors.q5}>
            <RadioGroup name="q5" value={answers.q5} onChange={set} options={['Daily','A few times a week','Once a week','A few times a month','Rarely','Never – I only consume content']} />
          </QCard>

          <QCard id="q5b" num="Q5b" label="Where do you currently find hockey community content online? (Select all that apply)">
            <CheckGroup name="q5b" values={answers.q5b} onChange={set} options={['Instagram','TikTok','Facebook / Facebook Groups','Reddit (r/hockey etc.)','YouTube','Twitter / X','Discord',"I don't really find it anywhere"]} />
          </QCard>

          <QCard id="q6" num="Q6" label="What type of hockey content do you most like to see? (Select all that apply)">
            <CheckGroup name="q6" values={answers.q6} onChange={set} options={['Goal clips and highlights','Game recaps','Drills and training tips','Player profiles / stories','Hockey news and scores','Beer league / rec content','Behind-the-scenes / locker room content','Gear and equipment reviews']} />
          </QCard>

          <QCard id="q7" num="Q7" label="How frustrated are you that there's no dedicated hockey social platform?" required error={errors.q7}>
            <Scale10 name="q7" value={answers.q7} onChange={set} labelLow="Not at all" labelHigh="Extremely" />
          </QCard>

          <QCard id="q8" num="Q8" label='Have you ever felt like your hockey content gets "buried" by the algorithm on Instagram or TikTok?' required error={errors.q8}>
            <RadioGroup name="q8" value={answers.q8} onChange={set} options={['Yes – constantly','Yes – sometimes','Not really','Never thought about it',"I don't post hockey content"]} />
          </QCard>

          {/* ── SECTION 3 ── */}
          <SectionHeader num="03" title="The Rinkd Concept" />

          <QCard id="q9" num="Q9" label="Rinkd is a social platform built exclusively for the hockey community — think Instagram meets Facebook Groups, but hockey-only. How would you describe your initial reaction?" required error={errors.q9}>
            <RadioGroup name="q9" value={answers.q9} onChange={set} options={["This is exactly what I've been waiting for","Really interested – I'd try it","Somewhat interested – depends on the features","Not sure – I'm not big on social media","Not interested"]} />
          </QCard>

          <QCard id="q10" num="Q10" label="Which Rinkd features are most exciting to you? (Select your top 3)">
            <CheckGroup name="q10" values={answers.q10} onChange={set} options={['Goal clips and highlight feed','Custom player profile / hockey identity page','League and team community pages','Tier / reputation system (Mite → Pro)','Rinkd Cards (AI-generated hockey cards)','Rinkside – daily hockey news and highlights','Crease – original shows and pro interviews','Merch store with tier-based discounts']} />
          </QCard>

          <QCard id="q11" num="Q11" label="How important is it to you that a hockey platform is age-appropriate and safe for youth players?">
            <Scale10 name="q11" value={answers.q11} onChange={set} labelLow="Not important" labelHigh="Critical" />
          </QCard>

          <QCard id="q12" num="Q12" label="Have you ever scored a big goal, made a great save, or had a game moment you wished you could share with a hockey-specific audience?" required error={errors.q12}>
            <RadioGroup name="q12" value={answers.q12} onChange={set} options={['Yes – all the time','Yes – a few times','Not really',"I'm a parent / fan so not applicable"]} />
          </QCard>

          {/* ── SECTION 4 ── */}
          <SectionHeader num="04" title="Feature Interest" />

          <QCard id="q13" num="Q13" label="How likely are you to use each of the following features? (1 = not at all, 5 = definitely)">
            <div className="sv-likelihood-grid">
              {[['Goal / highlight feed','q13a'],['Player profile page','q13b'],['League / team pages','q13c'],['Tier / reward system','q13d'],['Rinkside daily news','q13e'],['Crease premium shows','q13f']].map(([label, name]) => (
                <LikelihoodRow key={name} label={label} name={name} value={answers[name]} onChange={set} />
              ))}
            </div>
          </QCard>

          <QCard id="q14" num="Q14" label="Would you pay for Crease, a premium subscription with original hockey shows and exclusive content?">
            <RadioGroup name="q14" value={answers.q14} onChange={set} options={['Yes – definitely','Yes – if the content is great','Maybe – need to see it first','Probably not','No']} />
          </QCard>

          <QCard id="q14b" num="Q14b" label="Rinkd Cards: upload your photo and our AI generates a personalized pro-style hockey card with your tier, position, and Rinkd handle. Weekly drops from $2.99. How interested are you?">
            <RadioGroup name="q14b" value={answers.q14b} onChange={set} options={['Very interested – I\'d buy one immediately','Interested – I\'d try it','Somewhat interested','Not really my thing','Not interested']} />
          </QCard>

          {/* ── SECTION 5 ── */}
          <SectionHeader num="05" title="Merch & Spending" />

          <QCard id="q15" num="Q15" label="How much do you spend on hockey gear and apparel per year?">
            <RadioGroup name="q15" value={answers.q15} onChange={set} options={['Under $100','$100 – $300','$300 – $600','$600 – $1,000','$1,000+']} />
          </QCard>

          <QCard id="q16" num="Q16" label="Would you buy Rinkd-branded merchandise (hoodies, hats, bags)?">
            <RadioGroup name="q16" value={answers.q16} onChange={set} options={['Yes – definitely','Yes – if the quality is good','Maybe','Probably not','No']} />
          </QCard>

          <QCard id="q17" num="Q17" label="What price range would you consider for a premium Rinkd hoodie?">
            <RadioGroup name="q17" value={answers.q17} onChange={set} options={['Under $40','$40 – $60','$60 – $80','$80 – $100','$100+ for the right quality']} />
          </QCard>

          {/* ── SECTION 6 ── */}
          <SectionHeader num="06" title="Community & Growth" />

          <QCard id="q18" num="Q18" label="What would make you post content on Rinkd regularly? (Select all that apply)">
            <CheckGroup name="q18" values={answers.q18} onChange={set} options={['Knowing my content reaches hockey people specifically','Earning points and moving up the tier system','My teammates and league being on it','Chance to get featured on Rinkside','Merch discounts through the tier system','Building a following within the hockey community',"Nothing – I just consume content, I don't post"]} />
          </QCard>

          <QCard id="q19" num="Q19" label="Overall, how would you rate the appeal of Rinkd as a concept?" required error={errors.q19}>
            <Scale10 name="q19" value={answers.q19} onChange={set} labelLow="Not appealing" labelHigh="Extremely appealing" />
          </QCard>

          <QCard id="q20" num="Q20" label="What's the single most important thing Rinkd needs to get right?">
            <textarea className="sv-textarea" rows={3} placeholder="Tell us what matters most to you..." value={answers.q20 || ''} onChange={e => set('q20', e.target.value)} />
          </QCard>

          <QCard id="q21" num="Q21" label="What concerns, if any, do you have about Rinkd?">
            <textarea className="sv-textarea" rows={3} placeholder="Any worries or questions you have..." value={answers.q21 || ''} onChange={e => set('q21', e.target.value)} />
          </QCard>

          <QCard id="q22" num="Q22" label="If Rinkd launched tomorrow with the features described above, how likely would you be to invite your teammates or hockey network to join?" required error={errors.q22}>
            <Scale10 name="q22" value={answers.q22} onChange={set} labelLow="Definitely not" labelHigh="Absolutely yes" />
          </QCard>

          <QCard id="q23" num="Q23 · JOIN THE WAITLIST" label="Want early access when Rinkd launches? Drop your email and we'll notify you first — plus reserve your Rinkd handle before the public." highlight>
            <input className="sv-input" type="email" placeholder="your@email.com" value={answers.q23_email || ''} onChange={e => set('q23_email', e.target.value)} />
            <input className="sv-input" type="text" placeholder="Preferred Rinkd handle (e.g. @gretzky99)" value={answers.q23_handle || ''} onChange={e => set('q23_handle', e.target.value)} />
            <p style={{fontSize:12,color:'var(--steel)'}}>🔒 No spam. Ever. Just the launch notice when we're ready.</p>
          </QCard>

          <div className="sv-submit-section">
            <p className="sv-submit-note">Fields marked <span className="sv-req">*</span> are required. All other questions are optional.</p>
            <button type="submit" className="sv-submit-btn" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit Survey 🏒'}
            </button>
          </div>

        </form>
      </div>

      <footer className="sv-footer">
        <div className="sv-footer-brands">
          <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:12,letterSpacing:'0.12em',textTransform:'uppercase',color:'#fff'}}>RINKD</span>
          <span style={{color:'#1E3A5C'}}>·</span>
          <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:12,letterSpacing:'0.12em',textTransform:'uppercase',color:'#2E5B8C'}}>RINKSIDE</span>
          <span style={{color:'#1E3A5C'}}>·</span>
          <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:12,letterSpacing:'0.12em',textTransform:'uppercase',color:'#D72638'}}>CREASE</span>
        </div>
        <div className="sv-footer-copy">Pete@rinkd.app · rinkd.app · © 2026 Rinkd LLC</div>
      </footer>
    </div>
  );
}
