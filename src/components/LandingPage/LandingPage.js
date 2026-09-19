import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  HeartPulse,
  Ear,
  Stethoscope,
  FlaskConical,
  Venus,
  Baby,
  Brain,
  BriefcaseMedical,
  Dumbbell,
  MapPin,
  Phone,
  Clock,
  CalendarCheck,
  Menu,
  X,
  ArrowRight,
  ExternalLink,
} from "lucide-react";

const styles = `
  :root {
    --primary: #123b73;
    --primary-2: #1d5ca7;
    --primary-3: #4585d4;
    --accent: #0e9aa7;
    --accent-2: #12b2bf;
    --ink: #15263c;
    --muted: #61758d;
    --line: #d9e4f1;
    --line-soft: #eaf0f7;
    --bg: #f3f7fc;
    --surface: #ffffff;
    --surface-2: #f8fbff;
    --success: #177f59;
    --warning: #c07b18;
    --danger: #c34656;
    --shadow-lg: 0 28px 70px rgba(17, 34, 68, 0.14);
    --shadow-md: 0 16px 34px rgba(17, 34, 68, 0.08);
    --shadow-sm: 0 10px 18px rgba(17, 34, 68, 0.05);
    --radius-xl: 34px;
    --radius-lg: 26px;
    --radius-md: 20px;
    --radius-sm: 14px;
    --container: 1380px;
    --header-height: 88px;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html {
    scroll-behavior: smooth;
  }

  body {
    font-family: Inter, "Segoe UI", Arial, sans-serif;
    color: var(--ink);
    background:
      radial-gradient(circle at top left, rgba(69, 133, 212, 0.14), transparent 28%),
      radial-gradient(circle at bottom right, rgba(14, 154, 167, 0.10), transparent 22%),
      linear-gradient(180deg, #fbfdff 0%, #f3f7fc 100%);
    line-height: 1.5;
  }

  img {
    max-width: 100%;
    display: block;
  }

  a {
    color: inherit;
    text-decoration: none;
  }

  button {
    font: inherit;
    border: none;
    background: none;
    cursor: pointer;
  }

  /* Keyboard focus ring — visible on both the dark hero and light sections. */
  a:focus-visible,
  button:focus-visible {
    outline: 3px solid var(--accent-2);
    outline-offset: 3px;
  }

  @media (prefers-reduced-motion: reduce) {
    html {
      scroll-behavior: auto;
    }

    *,
    *::before,
    *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
    }

    .btn:hover,
    .dept-card:hover {
      transform: none;
    }
  }

  .container {
    width: min(calc(100% - 40px), var(--container));
    margin: 0 auto;
  }

  .site-header {
    position: sticky;
    top: 0;
    z-index: 1000;
    height: var(--header-height);
    backdrop-filter: blur(16px);
    background: rgba(250, 252, 255, 0.84);
    border-bottom: 1px solid rgba(217, 228, 241, 0.92);
  }

  .site-header .inner {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }

  .brand-mark {
    width: 56px;
    height: 56px;
    border-radius: 18px;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    background: linear-gradient(145deg, var(--primary-3), var(--primary));
    color: #fff;
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.18),
      0 12px 22px rgba(18, 59, 115, 0.18);
  }

  .brand-mark svg {
    width: 28px;
    height: 28px;
  }

  .brand-copy strong {
    display: block;
    font-size: 1.08rem;
    font-weight: 900;
    letter-spacing: 0.02em;
    color: var(--primary);
  }

  .brand-copy span {
    display: block;
    font-size: 0.84rem;
    color: var(--muted);
    margin-top: 2px;
  }

  .nav {
    display: flex;
    align-items: center;
    gap: 30px;
  }

  .nav a {
    font-size: 0.95rem;
    font-weight: 800;
    color: #30465f;
    position: relative;
    transition: color 0.18s ease;
  }

  .nav a::after {
    content: "";
    position: absolute;
    left: 0;
    bottom: -7px;
    width: 100%;
    height: 2px;
    background: linear-gradient(90deg, var(--primary-2), var(--accent));
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.18s ease;
  }

  .nav a:hover {
    color: var(--primary);
  }

  .nav a:hover::after {
    transform: scaleX(1);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  /* Keep the two header buttons the same height so they align cleanly. */
  .header-actions .btn-outline,
  .header-actions .btn-primary {
    min-height: 48px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
    white-space: nowrap;
  }

  .btn:hover {
    transform: translateY(-1px);
  }

  .btn-outline {
    min-height: 48px;
    padding: 0 18px;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: rgba(255,255,255,0.92);
    color: var(--primary);
    font-weight: 800;
  }

  .btn-primary {
    min-height: 52px;
    padding: 0 22px;
    border-radius: 15px;
    color: #fff;
    font-weight: 800;
    background: linear-gradient(180deg, var(--primary-3), var(--primary-2) 42%, var(--primary));
    box-shadow: 0 14px 26px rgba(18, 59, 115, 0.16);
  }

  .mobile-toggle {
    display: none;
    width: 48px;
    height: 48px;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: rgba(255,255,255,0.94);
    color: var(--primary);
  }

  .mobile-toggle svg {
    width: 22px;
    height: 22px;
  }

  .hero {
    padding: 34px 0 26px;
  }

  .hero-grid {
    display: grid;
    grid-template-columns: 1.15fr 0.85fr;
    gap: 24px;
    align-items: stretch;
  }

  .hero-panel {
    min-height: 700px;
    padding: 38px;
    border-radius: var(--radius-xl);
    position: relative;
    overflow: hidden;
    background:
      linear-gradient(145deg, rgba(18,59,115,0.98), rgba(29,92,167,0.94)),
      linear-gradient(180deg, var(--primary), var(--primary-2));
    color: #fff;
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .hero-panel::before,
  .hero-panel::after {
    content: "";
    position: absolute;
    border-radius: 999px;
    pointer-events: none;
  }

  .hero-panel::before {
    width: 420px;
    height: 420px;
    right: -130px;
    top: -120px;
    background: radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.04) 58%, transparent 74%);
  }

  .hero-panel::after {
    width: 320px;
    height: 320px;
    left: -110px;
    bottom: -110px;
    background: radial-gradient(circle, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.03) 56%, transparent 74%);
  }

  .hero-top,
  .hero-body,
  .hero-bottom {
    position: relative;
    z-index: 1;
  }

  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 10px 15px;
    border-radius: 999px;
    background: rgba(255,255,255,0.10);
    border: 1px solid rgba(255,255,255,0.16);
    font-size: 0.83rem;
    font-weight: 800;
    letter-spacing: 0.02em;
    margin-bottom: 22px;
  }

  .eyebrow .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #5eead4;
  box-shadow: 0 0 0 4px rgba(94,234,212,.18);
  }

  .hero-title {
    font-size: clamp(2.7rem, 5.4vw, 5rem);
    font-weight: 800;
    line-height: 1.0;
    letter-spacing: -0.03em;
    max-width: 760px;
    margin-bottom: 18px;
    text-wrap: balance;
  }

  .hero-lead {
    max-width: 680px;
    color: rgba(255,255,255,0.84);
    font-size: 1.06rem;
    line-height: 1.75;
  }

  .hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    margin-top: 28px;
  }

  .btn-light {
    min-height: 54px;
    padding: 0 22px;
    border-radius: 15px;
    background: #fff;
    color: var(--primary);
    font-weight: 800;
    box-shadow: 0 14px 24px rgba(8, 24, 48, 0.14);
  }

  .btn-ghost {
    min-height: 54px;
    padding: 0 22px;
    border-radius: 15px;
    font-weight: 800;
    color: #fff;
    border: 1px solid rgba(255,255,255,0.18);
    background: rgba(255,255,255,0.08);
  }

  .hero-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
    margin-top: 32px;
  }

  .stat-card {
    padding: 18px;
    border-radius: 20px;
    background: rgba(255,255,255,0.10);
    border: 1px solid rgba(255,255,255,0.14);
    backdrop-filter: blur(12px);
  }

  .stat-card .label {
    color: rgba(255,255,255,0.76);
    font-size: 0.8rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
  }

  .stat-card .value {
    font-size: 1.35rem;
    font-weight: 900;
    line-height: 1.2;
  }

  .stat-card .sub {
    color: rgba(255,255,255,0.80);
    font-size: 0.84rem;
    line-height: 1.5;
    margin-top: 8px;
  }

  .hero-bottom {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    align-items: end;
    margin-top: 30px;
    color: rgba(255,255,255,0.76);
    font-size: 0.92rem;
  }

  .hero-side {
    display: grid;
    gap: 18px;
  }

  .panel {
    background: rgba(255,255,255,0.96);
    border: 1px solid rgba(217,228,241,0.96);
    border-radius: 28px;
    box-shadow: var(--shadow-md);
    padding: 26px;
  }

  .panel-head {
    margin-bottom: 16px;
  }

  .panel-head h2,
  .panel-head h3 {
    font-size: 1.42rem;
    line-height: 1.1;
    letter-spacing: -0.03em;
    margin-bottom: 8px;
    color: #152c49;
  }

  .panel-head p {
    color: var(--muted);
    font-size: 0.95rem;
    line-height: 1.65;
  }

  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-top: 14px;
  }

  .info-card {
    min-height: 132px;
    padding: 18px;
    border-radius: 20px;
    background: linear-gradient(180deg, #ffffff, #f8fbff);
    border: 1px solid var(--line-soft);
  }

  .info-card .kicker {
    color: #38516c;
    font-size: 0.82rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
  }

  .info-card .main {
    color: var(--primary);
    font-size: 1.2rem;
    font-weight: 900;
    line-height: 1.25;
  }

  .info-card .desc {
    color: var(--muted);
    font-size: 0.84rem;
    line-height: 1.55;
    margin-top: 8px;
  }

  .contact-list {
    display: grid;
    gap: 14px;
    margin-top: 12px;
  }

  .contact-item {
    display: grid;
    grid-template-columns: 48px 1fr;
    gap: 14px;
    align-items: start;
    padding: 16px;
    border-radius: 18px;
    background: linear-gradient(180deg, #ffffff, #fbfdff);
    border: 1px solid var(--line-soft);
  }

  .contact-icon {
    width: 48px;
    height: 48px;
    border-radius: 15px;
    display: grid;
    place-items: center;
    background: linear-gradient(145deg, rgba(18,59,115,0.10), rgba(14,154,167,0.10));
    color: var(--primary);
    border: 1px solid rgba(18,59,115,0.10);
  }

  .contact-icon svg {
    width: 21px;
    height: 21px;
  }

  .contact-item strong {
    display: block;
    margin-bottom: 5px;
    font-size: 0.98rem;
    color: #19314f;
  }

  .contact-item span,
  .contact-item a {
    color: var(--muted);
    font-size: 0.92rem;
    line-height: 1.65;
  }

  .section {
    padding: 30px 0;
  }

  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: end;
    gap: 20px;
    margin-bottom: 20px;
  }

  .section-copy h2 {
    font-size: clamp(2rem, 3vw, 2.9rem);
    line-height: 1.02;
    letter-spacing: -0.06em;
    margin-bottom: 10px;
    color: #10233f;
  }

  .section-copy p {
    max-width: 800px;
    color: var(--muted);
    font-size: 0.98rem;
    line-height: 1.75;
  }

  .about-layout {
    display: grid;
    grid-template-columns: 1.05fr 0.95fr;
    gap: 20px;
    align-items: stretch;
  }

  .about-card {
    padding: 28px;
    border-radius: 28px;
    background: #fff;
    border: 1px solid rgba(217,228,241,0.96);
    box-shadow: var(--shadow-md);
  }

  .about-card p {
    color: #4f6175;
    line-height: 1.85;
    font-size: 0.98rem;
    margin-bottom: 14px;
  }

  .about-card p:last-child {
    margin-bottom: 0;
  }

  .feature-list {
    display: grid;
    gap: 14px;
  }

  .feature-card {
    padding: 20px;
    border-radius: 24px;
    background: #fff;
    border: 1px solid rgba(217,228,241,0.96);
    box-shadow: var(--shadow-md);
    display: grid;
    grid-template-columns: 54px 1fr;
    gap: 14px;
    align-items: start;
  }

  .feature-icon {
    width: 54px;
    height: 54px;
    border-radius: 18px;
    display: grid;
    place-items: center;
    background: linear-gradient(145deg, rgba(18,59,115,0.10), rgba(14,154,167,0.10));
    color: var(--primary);
    border: 1px solid rgba(18,59,115,0.10);
  }

  .feature-icon svg {
    width: 24px;
    height: 24px;
  }

  .feature-card strong {
    display: block;
    font-size: 1rem;
    color: #1b3554;
    margin-bottom: 6px;
  }

  .feature-card span {
    color: var(--muted);
    font-size: 0.92rem;
    line-height: 1.65;
  }

  .departments-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 18px;
  }

  .dept-card {
    min-height: 240px;
    padding: 22px;
    border-radius: 26px;
    background: #fff;
    border: 1px solid rgba(217,228,241,0.96);
    box-shadow: var(--shadow-md);
    display: flex;
    flex-direction: column;
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  }

  .dept-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 22px 36px rgba(17,34,68,0.10);
    border-color: #c8d8eb;
  }

  .dept-icon {
    width: 54px;
    height: 54px;
    border-radius: 17px;
    display: grid;
    place-items: center;
    background: linear-gradient(145deg, rgba(69,133,212,0.14), rgba(14,154,167,0.12));
    border: 1px solid rgba(69,133,212,0.12);
    color: var(--primary);
    margin-bottom: 16px;
  }

  .dept-icon svg {
    width: 24px;
    height: 24px;
  }

  .dept-card h3 {
    font-size: 1.12rem;
    letter-spacing: -0.02em;
    margin-bottom: 8px;
    color: #183253;
  }

  .dept-card p {
    color: var(--muted);
    font-size: 0.92rem;
    line-height: 1.7;
    margin-bottom: 16px;
  }

  .dept-chip {
    margin-top: auto;
    display: inline-flex;
    align-items: center;
    padding: 9px 12px;
    border-radius: 999px;
    border: 1px solid #dce7f5;
    background: #f5f9ff;
    color: var(--primary);
    font-size: 0.8rem;
    font-weight: 800;
    width: fit-content;
  }

  .visit-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 18px;
  }

  .visit-card {
    padding: 24px;
    border-radius: 26px;
    background: #fff;
    border: 1px solid rgba(217,228,241,0.96);
    box-shadow: var(--shadow-md);
  }

  .visit-card h3 {
    font-size: 1.06rem;
    margin-bottom: 10px;
    color: #183253;
  }

  .visit-card p {
    color: var(--muted);
    font-size: 0.92rem;
    line-height: 1.72;
    margin-bottom: 16px;
  }

  .visit-list {
    display: grid;
    gap: 10px;
  }

  .visit-list li {
    list-style: none;
    display: grid;
    grid-template-columns: 8px 1fr;
    gap: 12px;
    color: #43566c;
    font-size: 0.9rem;
    line-height: 1.65;
    align-items: start;
  }

  .visit-list li::before {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: linear-gradient(145deg, var(--primary-3), var(--accent));
    margin-top: 8px;
  }

  .cta-box {
    margin-top: 20px;
    padding: 32px;
    border-radius: 30px;
    background:
      radial-gradient(circle at top right, rgba(69,133,212,0.14), transparent 30%),
      linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
    border: 1px solid rgba(217,228,241,0.96);
    box-shadow: var(--shadow-md);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 22px;
  }

  .cta-copy h2 {
    font-size: clamp(1.9rem, 2.7vw, 2.7rem);
    line-height: 1.03;
    letter-spacing: -0.05em;
    margin-bottom: 10px;
    color: #10233f;
  }

  .cta-copy p {
    max-width: 780px;
    color: var(--muted);
    line-height: 1.8;
    font-size: 0.98rem;
  }

  .footer {
    padding: 28px 0 40px;
  }

  .footer-bar {
    padding-top: 22px;
    border-top: 1px solid #dbe5f0;
    display: flex;
    justify-content: space-between;
    gap: 18px;
    flex-wrap: wrap;
    color: var(--muted);
    font-size: 0.9rem;
  }

  .backdrop-nav {
    display: none;
  }

  @media (max-width: 1180px) {
    .hero-grid,
    .about-layout,
    .visit-grid {
      grid-template-columns: 1fr;
    }

    .departments-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .hero-panel {
      min-height: auto;
    }
  }

  @media (max-width: 960px) {
    .nav {
      display: none;
    }

    .mobile-toggle {
      display: inline-grid;
      place-items: center;
    }

    .header-actions .btn-outline {
      display: none;
    }

    .hero-stats,
    .info-grid {
      grid-template-columns: 1fr;
    }

    .cta-box {
      flex-direction: column;
      align-items: flex-start;
    }

    .backdrop-nav {
      display: none;
      position: fixed;
      top: var(--header-height);
      left: 0;
      right: 0;
      background: rgba(255,255,255,0.98);
      border-bottom: 1px solid var(--line);
      box-shadow: var(--shadow-md);
      z-index: 999;
    }

    .backdrop-nav.show {
      display: block;
    }

    .backdrop-nav .menu {
      width: min(calc(100% - 24px), var(--container));
      margin: 0 auto;
      padding: 14px 0 18px;
      display: grid;
      gap: 8px;
    }

    .backdrop-nav a {
      padding: 12px 14px;
      border-radius: 14px;
      color: #24405f;
      font-weight: 800;
    }

    .backdrop-nav a:hover {
      background: #f3f8ff;
    }
  }

  @media (max-width: 640px) {
    .container {
      width: min(calc(100% - 20px), var(--container));
    }

    .site-header {
      height: 76px;
    }

    .brand-mark {
      width: 48px;
      height: 48px;
      border-radius: 16px;
    }

    .hero {
      padding-top: 20px;
    }

    .hero-panel,
    .panel,
    .about-card,
    .feature-card,
    .dept-card,
    .visit-card,
    .cta-box {
      padding: 20px;
      border-radius: 22px;
    }

    .departments-grid {
      grid-template-columns: 1fr;
    }

    .hero-actions {
      flex-direction: column;
    }

    .btn-light,
    .btn-ghost,
    .btn-primary {
      width: 100%;
    }

    .hero-bottom,
    .footer-bar {
      flex-direction: column;
      align-items: flex-start;
    }
  }
`;

// Shared department icons keep a single consistent Lucide look.
const iconProps = { strokeWidth: 1.9, "aria-hidden": true };

const stats = [
  {
    label: "Location",
    value: "Festival Supermall",
    sub: "Filinvest Alabang, Muntinlupa City",
  },
  {
    label: "Contact",
    value: "(02) 8842-5405",
    sub: "Main public clinic number",
  },
  {
    label: "Hours",
    value: "8:00 AM-8:00 PM",
    sub: "Monday to Saturday",
  },
  {
    label: "Clinic Type",
    value: "Multi-Specialty",
    sub: "Outpatient clinic services",
  },
];

const infoCards = [
  {
    kicker: "Address",
    main: "Festival Supermall",
    desc: "Located at Festival Supermall, Filinvest Alabang, Muntinlupa City.",
  },
  {
    kicker: "Sunday Hours",
    main: "8:00 AM-8:00 PM",
    desc: "Weekend clinic hours for patient visits and consultations.",
  },
  {
    kicker: "Facebook",
    main: "kobeclinicalabang",
    desc: "Visit the official public page for clinic updates and communication.",
  },
  {
    kicker: "Portal Access",
    main: "Secure Sign In",
    desc: "Returning users may continue to the clinic portal through the sign in button.",
  },
];

const departments = [
  {
    title: "Cardiology",
    body: "Consultation support for heart-related concerns, cardiovascular follow-ups, and patient monitoring.",
    chip: "Heart care",
    icon: HeartPulse,
  },
  {
    title: "ENT",
    body: "Ear, nose, and throat consultations for common concerns, specialty evaluation, and follow-up care.",
    chip: "Ear, nose, throat",
    icon: Ear,
  },
  {
    title: "Internal Medicine",
    body: "Adult medical consultations for general health concerns, chronic condition review, and follow-up care.",
    chip: "Adult medicine",
    icon: Stethoscope,
  },
  {
    title: "Laboratory",
    body: "Diagnostic support for laboratory testing, specimen services, and coordinated result processing.",
    chip: "Diagnostics",
    icon: FlaskConical,
  },
  {
    title: "OB-Gyne",
    body: "Women's health consultations, screening support, pregnancy-related care, and follow-up visits.",
    chip: "Women's health",
    icon: Venus,
  },
  {
    title: "Pediatrics",
    body: "Child-focused consultations, routine checkups, developmental care, and family-oriented medical visits.",
    chip: "Child care",
    icon: Baby,
  },
  {
    title: "Psychiatry",
    body: "Mental health consultations for confidential care, patient review, and continuity of treatment.",
    chip: "Mental health",
    icon: Brain,
  },
  {
    title: "General Medicine",
    body: "Primary care consultations for common concerns, follow-up visits, and referrals to specialty care.",
    chip: "Primary care",
    icon: BriefcaseMedical,
  },
  {
    title: "Rehabilitation",
    body: "Rehabilitation support for recovery, movement improvement, therapy follow-ups, and functional care.",
    chip: "Recovery support",
    icon: Dumbbell,
  },
];

const visitCards = [
  {
    title: "Clinic Location",
    body: "KOBE CLINIC is located at Festival Supermall, Filinvest Alabang, Muntinlupa City.",
    items: [
      "Accessible clinic location inside Festival Supermall",
      "Convenient for patients and families in the Alabang area",
      "Easy to reach for consultations, follow-ups, and clinic visits",
    ],
  },
  {
    title: "Operating Hours",
    body: "The clinic provides regular weekday and weekend hours for patient visits.",
    items: [
      "Monday to Saturday: 8:00 AM to 8:00 PM",
      "Sunday: 8:00 AM to 8:00 PM",
      "Patients are encouraged to confirm schedules before visiting",
    ],
  },
  {
    title: "Patient Access",
    body: "KOBE CLINIC provides a simple digital entry point for patients who need to access the clinic portal.",
    items: [
      "Use the Sign in button to continue to the patient portal",
      "View clinic departments and visit information from the homepage",
      "Follow the Facebook page for public updates and clinic communication",
    ],
  },
];

function Header({ isMenuOpen, setIsMenuOpen }) {
  const closeMenu = () => setIsMenuOpen(false);

  return (
    <>
      <header className="site-header">
        <div className="container inner">
          <a href="#home" className="brand" aria-label="KOBE CLINIC Home" onClick={closeMenu}>
            <div className="brand-mark" aria-hidden="true">
              <Plus strokeWidth={2.75} />
            </div>
            <div className="brand-copy">
              <strong>KOBE CLINIC</strong>
              <span>Multi-Specialty Clinic in Alabang</span>
            </div>
          </a>

          <nav className="nav" aria-label="Primary navigation">
            <a href="#about">About</a>
            <a href="#departments">Departments</a>
            <a href="#visit">Visit Information</a>
            <a href="#contact">Contact</a>
          </nav>

          <div className="header-actions">
            <a className="btn btn-outline" href="https://www.facebook.com/kobeclinicalabang/" target="_blank" rel="noreferrer">
              Facebook Page
            </a>
            <Link className="btn btn-primary" to="/login">
              Sign in
            </Link>
            <button
              className="mobile-toggle"
              aria-label={isMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={isMenuOpen}
              aria-controls="mobile-menu"
              type="button"
              onClick={() => setIsMenuOpen((open) => !open)}
            >
              {isMenuOpen ? <X strokeWidth={2.1} /> : <Menu strokeWidth={2.1} />}
            </button>
          </div>
        </div>
      </header>

      <div className={`backdrop-nav${isMenuOpen ? " show" : ""}`} id="mobile-menu">
        <div className="menu">
          <a href="#about" onClick={closeMenu}>About</a>
          <a href="#departments" onClick={closeMenu}>Departments</a>
          <a href="#visit" onClick={closeMenu}>Visit Information</a>
          <a href="#contact" onClick={closeMenu}>Contact</a>
          <Link to="/login" onClick={closeMenu}>Sign in</Link>
        </div>
      </div>
    </>
  );
}

function Hero() {
  return (
    <section className="hero">
      <div className="container hero-grid">
        <section className="hero-panel">
          <div className="hero-top">
            <div className="eyebrow">
              <span className="dot" />
              Multi-Specialty Clinic in Alabang
            </div>
          </div>

          <div className="hero-body">
            <h1 className="hero-title">Trusted outpatient care for patients and families in Alabang.</h1>
            <p className="hero-lead">
              KOBE CLINIC is a multi-specialty clinic located at Festival Supermall, Filinvest Alabang, Muntinlupa City. The clinic provides accessible outpatient care through several medical departments, helping patients find the right consultation, diagnostic support, and follow-up care in one convenient location.
            </p>

            <div className="hero-actions">
              <Link className="btn btn-light" to="/login">
                Sign in to portal
                <ArrowRight size={18} strokeWidth={2.4} />
              </Link>
              <a className="btn btn-ghost" href="#departments">View departments</a>
            </div>

            <div className="hero-stats">
              {stats.map((stat) => (
                <article className="stat-card" key={stat.label}>
                  <div className="label">{stat.label}</div>
                  <div className="value">{stat.value}</div>
                  <div className="sub">{stat.sub}</div>
                </article>
              ))}
            </div>
          </div>

          <div className="hero-bottom">
            <span>For consultations, diagnostics, and follow-up care</span>
            <span>Festival Supermall, Filinvest Alabang</span>
          </div>
        </section>

        <aside className="hero-side">
          <section className="panel">
            <div className="panel-head">
              <h2>Clinic Snapshot</h2>
              <p>Essential clinic information arranged clearly for patients, families, and returning portal users.</p>
            </div>

            <div className="info-grid">
              {infoCards.map((card) => (
                <article className="info-card" key={card.kicker}>
                  <div className="kicker">{card.kicker}</div>
                  <div className="main">{card.main}</div>
                  <div className="desc">{card.desc}</div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel" id="contact">
            <div className="panel-head">
              <h3>Contact & Visit</h3>
              <p>Find the clinic location, contact number, public hours, and official Facebook page.</p>
            </div>

            <div className="contact-list">
              <div className="contact-item">
                <div className="contact-icon" aria-hidden="true">
                  <MapPin {...iconProps} />
                </div>
                <div>
                  <strong>Address</strong>
                  <span>2/F, Festival Supermall, Filinvest Alabang, Muntinlupa City, Philippines</span>
                </div>
              </div>

              <div className="contact-item">
                <div className="contact-icon" aria-hidden="true">
                  <Phone {...iconProps} />
                </div>
                <div>
                  <strong>Contact Number</strong>
                  <span><a href="tel:+63288425405">(02) 8842-5405</a></span>
                </div>
              </div>

              <div className="contact-item">
                <div className="contact-icon" aria-hidden="true">
                  <Clock {...iconProps} />
                </div>
                <div>
                  <strong>Public Hours</strong>
                  <span>Monday to Saturday: 8:00 AM-8:00 PM<br />Sunday: 8:00 AM-8:00 PM</span>
                </div>
              </div>

              <div className="contact-item">
                <div className="contact-icon" aria-hidden="true">
                  <ExternalLink {...iconProps} />
                </div>
                <div>
                  <strong>Facebook Page</strong>
                  <span><a href="https://www.facebook.com/kobeclinicalabang/" target="_blank" rel="noreferrer">facebook.com/kobeclinicalabang</a></span>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}

function AboutSection() {
  return (
    <section className="section" id="about">
      <div className="container">
        <div className="section-head">
          <div className="section-copy">
            <h2>About KOBE CLINIC</h2>
            <p>
              KOBE CLINIC is a multi-specialty outpatient clinic in Alabang that brings together different medical services in one accessible location.
            </p>
          </div>
        </div>

        <div className="about-layout">
          <article className="about-card">
            <p>
              KOBE CLINIC provides outpatient healthcare services for patients who need consultation, diagnostic support, follow-up care, and specialty-based medical attention. Located at Festival Supermall, Filinvest Alabang, the clinic is positioned in a convenient area for patients and families within Muntinlupa and nearby communities.
            </p>
            <p>
              As a multi-specialty clinic, KOBE CLINIC supports different healthcare needs through departments such as Internal Medicine, General Medicine, Pediatrics, Obstetrics and Gynecology, ENT, Psychiatry, Rehabilitation Medicine, Laboratory, and other specialty services. This setup allows patients to access several types of care in a single clinic environment.
            </p>
            <p>
              The clinic homepage is designed to give visitors a clear view of KOBE CLINIC's location, contact details, operating hours, available departments, and online access points. Patients can also use the Facebook page for public updates or proceed to sign in when they need digital access to clinic-related services.
            </p>
          </article>

          <div className="feature-list">
            <article className="feature-card">
              <div className="feature-icon" aria-hidden="true">
                <Stethoscope {...iconProps} />
              </div>
              <div>
                <strong>Multi-specialty care</strong>
                <span>KOBE CLINIC brings together several medical departments so patients can find the right care, consultation, or follow-up service in one place.</span>
              </div>
            </article>

            <article className="feature-card">
              <div className="feature-icon" aria-hidden="true">
                <MapPin {...iconProps} />
              </div>
              <div>
                <strong>Convenient Alabang location</strong>
                <span>The clinic is located at Festival Supermall, Filinvest Alabang, making it accessible for patients from Muntinlupa and nearby areas.</span>
              </div>
            </article>

            <article className="feature-card">
              <div className="feature-icon" aria-hidden="true">
                <CalendarCheck {...iconProps} />
              </div>
              <div>
                <strong>Patient-friendly access</strong>
                <span>The homepage highlights clinic details, departments, operating hours, Facebook access, and a direct sign in path for returning users.</span>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}

function DepartmentsSection() {
  return (
    <section className="section" id="departments">
      <div className="container">
        <div className="section-head">
          <div className="section-copy">
            <h2>Departments & Specialty Services</h2>
            <p>
              KOBE CLINIC brings together multiple outpatient services so patients can find consultation, diagnostics, and follow-up care in one clinic environment.
            </p>
          </div>
        </div>

        <div className="departments-grid">
          {departments.map((department) => {
            const DeptIcon = department.icon;
            return (
              <article className="dept-card" key={department.title}>
                <div className="dept-icon" aria-hidden="true">
                  <DeptIcon {...iconProps} />
                </div>
                <h3>{department.title}</h3>
                <p>{department.body}</p>
                <span className="dept-chip">{department.chip}</span>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function VisitSection() {
  return (
    <section className="section" id="visit">
      <div className="container">
        <div className="section-head">
          <div className="section-copy">
            <h2>Visit Information</h2>
            <p>
              A helpful clinic homepage should make visit details easy to find: where the clinic is, when it is open, how to contact it, and how returning users can continue online.
            </p>
          </div>
        </div>

        <div className="visit-grid">
          {visitCards.map((card) => (
            <article className="visit-card" key={card.title}>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
              <ul className="visit-list">
                {card.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <div className="cta-box">
          <div className="cta-copy">
            <h2>Plan your visit to KOBE CLINIC.</h2>
            <p>
              Review the clinic location, public hours, departments, and contact details before your visit. Returning users may continue to sign in for online clinic access.
            </p>
          </div>
          <Link className="btn btn-primary" to="/login">
            Proceed to Sign in
            <ArrowRight size={18} strokeWidth={2.4} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-bar">
        <span>KOBE CLINIC - Multi-Specialty Clinic in Alabang</span>
        <span>Festival Supermall, Filinvest Alabang, Muntinlupa City - (02) 8842-5405</span>
      </div>
    </footer>
  );
}

export default function KobeClinicReact() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Let keyboard users dismiss the mobile menu with Escape.
  useEffect(() => {
    if (!isMenuOpen) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMenuOpen]);

  return (
    <>
      <style>{styles}</style>
      <Header isMenuOpen={isMenuOpen} setIsMenuOpen={setIsMenuOpen} />
      <main id="home">
        <Hero />
        <AboutSection />
        <DepartmentsSection />
        <VisitSection />
      </main>
      <Footer />
    </>
  );
}