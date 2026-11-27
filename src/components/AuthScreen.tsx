import { useState } from 'react';
import {
  ArrowRight,
  Building2,
  CheckCheck,
  Clock,
  Eye,
  EyeOff,
  FileText,
  Lock,
  Phone,
  Play,
  Users,
} from 'lucide-react';
import { DEMO_ASSETS } from '../data/demoSeed';

interface AuthScreenProps {
  loading: boolean;
  signingIn?: boolean;
  error: string | null;
  phoneOtpSentTo: string | null;
  localOtpHint?: string | null;
  onClearError: () => void;
  onCompanyAuth: (params: {
    identifier: string;
    password: string;
    displayName?: string;
    mode: 'signin' | 'signup';
  }) => Promise<boolean>;
  onRequestPhoneOtp: (phone: string) => Promise<boolean>;
  onVerifyPhoneOtp: (code: string, displayName?: string) => Promise<boolean>;
  onResetPhoneOtp: () => void;
  onTryDemo: () => void;
}

type PreviewTab = 'direct' | 'groups' | 'media';
type AuthMethod = 'company' | 'phone';

const PREVIEW_TABS: { id: PreviewTab; label: string }[] = [
  { id: 'direct', label: 'Direct Chats' },
  { id: 'groups', label: 'Group Rooms' },
  { id: 'media', label: 'Files & Voice' },
];

export function AuthScreen({
  loading,
  signingIn = false,
  error,
  phoneOtpSentTo,
  localOtpHint,
  onClearError,
  onCompanyAuth,
  onRequestPhoneOtp,
  onVerifyPhoneOtp,
  onResetPhoneOtp,
  onTryDemo,
}: AuthScreenProps) {
  const [previewTab, setPreviewTab] = useState<PreviewTab>('direct');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('company');

  // Company ID / Corporate Email + Password state
  const [companyMode, setCompanyMode] = useState<'signin' | 'signup'>('signin');
  const [companyIdentifier, setCompanyIdentifier] = useState('');
  const [companyPassword, setCompanyPassword] = useState('');
  const [companyDisplayName, setCompanyDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Phone OTP state
  const [phoneInput, setPhoneInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [phoneDisplayName, setPhoneDisplayName] = useState('');

  const authBusy = loading || signingIn;

  const switchMethod = (method: AuthMethod) => {
    setAuthMethod(method);
    onClearError();
  };

  const handleCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onCompanyAuth({
      identifier: companyIdentifier,
      password: companyPassword,
      displayName: companyDisplayName,
      mode: companyMode,
    });
  };

  const handlePhoneSend = async (e: React.FormEvent) => {
    e.preventDefault();
    await onRequestPhoneOtp(phoneInput);
  };

  const handlePhoneVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    await onVerifyPhoneOtp(otpInput, phoneDisplayName);
  };

  return (
    <div className="min-h-screen bg-[#F4F6F5] dark:bg-[#0B141A] flex flex-col">
      {/* Top Bar: Brand wordmark — interactive feature links — single action */}
      <header className="w-full max-w-6xl mx-auto px-5 sm:px-6 py-4 sm:py-5 flex items-center justify-between gap-6">
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[#0D7A5F] text-white flex items-center justify-center font-display font-bold text-sm">
            A
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-[#0F1B17] dark:text-[#EEF3F1]">
            ARK DM
          </span>
        </div>

        <nav aria-label="Feature previews" className="hidden md:flex items-center gap-6 text-sm font-medium">
          {PREVIEW_TABS.map(({ id, label }) => {
            const active = previewTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPreviewTab(id)}
                aria-current={active ? 'true' : undefined}
                className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors cursor-pointer border-b-2 ${
                  active
                    ? 'text-[#0F1B17] dark:text-[#EEF3F1] border-[#0D7A5F] dark:border-[#10B981]'
                    : 'text-[#5A6B64] dark:text-[#8FA3AD] border-transparent hover:text-[#0F1B17] dark:hover:text-[#EEF3F1]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={onTryDemo}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-[#D4DDD9] dark:border-[#263640] text-[#0F1B17] dark:text-[#EEF3F1] hover:bg-white dark:hover:bg-[#17232A] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          Open Demo
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center px-5 sm:px-6 py-6 sm:py-8">
        <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* Left column: Value prop & Self-Hosted Local Sign-In Card */}
          <div className="lg:col-span-5 flex flex-col items-start">
            <p className="text-xs font-medium tracking-wide text-[#0D7A5F] dark:text-[#34D399] mb-2.5 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Local Server · 48-Hour Auto-Delete</span>
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#0F1B17] dark:text-[#EEF3F1] leading-[1.12] text-balance mb-3">
              Private team messaging with automatic 48-hour purge.
            </h1>
            <p className="text-sm text-[#5A6B64] dark:text-[#8FA3AD] leading-relaxed mb-5 max-w-md">
              Hosted on your local server with SQLite and disk storage. Chats and uploaded files erase automatically after 48 hours.
            </p>

            {/* Sign-in Card */}
            <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#111B21] border border-[#DFE6E3] dark:border-[#223039] p-5 shadow-[0_12px_32px_-20px_rgba(15,27,23,0.16)]">
              {/* Method Switcher */}
              <div
                role="tablist"
                aria-label="Sign-in method"
                className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#F2F5F3] dark:bg-[#17232A] mb-4"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={authMethod === 'company'}
                  onClick={() => switchMethod('company')}
                  className={`h-9 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                    authMethod === 'company'
                      ? 'bg-white dark:bg-[#22323B] text-[#0F1B17] dark:text-[#EEF3F1] shadow-xs'
                      : 'text-[#5A6B64] dark:text-[#8FA3AD] hover:text-[#0F1B17] dark:hover:text-[#EEF3F1]'
                  }`}
                >
                  <Building2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Company ID</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={authMethod === 'phone'}
                  onClick={() => switchMethod('phone')}
                  className={`h-9 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                    authMethod === 'phone'
                      ? 'bg-white dark:bg-[#22323B] text-[#0F1B17] dark:text-[#EEF3F1] shadow-xs'
                      : 'text-[#5A6B64] dark:text-[#8FA3AD] hover:text-[#0F1B17] dark:hover:text-[#EEF3F1]'
                  }`}
                >
                  <Phone className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Phone Number</span>
                </button>
              </div>

              {error && (
                <div
                  role="alert"
                  className="mb-4 px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300 leading-relaxed"
                >
                  {error}
                </div>
              )}

              {/* Tab 1: Manual Company ID / Work Email + Password */}
              {authMethod === 'company' && (
                <form onSubmit={(e) => void handleCompanySubmit(e)} noValidate className="space-y-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#0F1B17] dark:text-[#EEF3F1]">
                      {companyMode === 'signin' ? 'Sign in with Company ID' : 'Create Company Account'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setCompanyMode((m) => (m === 'signin' ? 'signup' : 'signin'));
                        onClearError();
                      }}
                      className="text-xs font-medium text-[#0D7A5F] dark:text-[#34D399] hover:underline cursor-pointer"
                    >
                      {companyMode === 'signin' ? 'Create account' : 'Back to sign in'}
                    </button>
                  </div>

                  {companyMode === 'signup' && (
                    <div>
                      <label
                        htmlFor="auth-display-name"
                        className="block text-xs font-medium text-[#394A43] dark:text-[#B4C5CE] mb-1"
                      >
                        Full name
                      </label>
                      <input
                        id="auth-display-name"
                        type="text"
                        autoComplete="name"
                        value={companyDisplayName}
                        onChange={(e) => setCompanyDisplayName(e.target.value)}
                        placeholder="Prateek Parashar"
                        className="w-full h-10 px-3 rounded-xl bg-[#F4F7F5] dark:bg-[#17232A] text-sm text-[#0F1B17] dark:text-[#EEF3F1] placeholder:text-[#6B7C75] dark:placeholder:text-[#6E838E] border border-[#E1E7E4] dark:border-[#24343E] focus:border-[#0D7A5F] dark:focus:border-[#10B981] focus:bg-white dark:focus:bg-[#142027] focus:outline-none transition-colors"
                      />
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="auth-company-id"
                      className="block text-xs font-medium text-[#394A43] dark:text-[#B4C5CE] mb-1"
                    >
                      Company ID or work email
                    </label>
                    <input
                      id="auth-company-id"
                      type="text"
                      autoComplete="username"
                      value={companyIdentifier}
                      onChange={(e) => setCompanyIdentifier(e.target.value)}
                      placeholder="ARK-1042 or name@company.com"
                      className="w-full h-10 px-3 rounded-xl bg-[#F4F7F5] dark:bg-[#17232A] text-sm text-[#0F1B17] dark:text-[#EEF3F1] placeholder:text-[#6B7C75] dark:placeholder:text-[#6E838E] border border-[#E1E7E4] dark:border-[#24343E] focus:border-[#0D7A5F] dark:focus:border-[#10B981] focus:bg-white dark:focus:bg-[#142027] focus:outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="auth-password"
                      className="block text-xs font-medium text-[#394A43] dark:text-[#B4C5CE] mb-1"
                    >
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="auth-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete={companyMode === 'signup' ? 'new-password' : 'current-password'}
                        value={companyPassword}
                        onChange={(e) => setCompanyPassword(e.target.value)}
                        placeholder="Minimum 6 characters"
                        className="w-full h-10 pl-3 pr-10 rounded-xl bg-[#F4F7F5] dark:bg-[#17232A] text-sm text-[#0F1B17] dark:text-[#EEF3F1] placeholder:text-[#6B7C75] dark:placeholder:text-[#6E838E] border border-[#E1E7E4] dark:border-[#24343E] focus:border-[#0D7A5F] dark:focus:border-[#10B981] focus:bg-white dark:focus:bg-[#142027] focus:outline-none transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-1.5 top-1.5 w-7 h-7 rounded-lg flex items-center justify-center text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" aria-hidden="true" />
                        ) : (
                          <Eye className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={authBusy}
                    className="w-full h-11 px-4 rounded-xl bg-[#0D7A5F] hover:bg-[#0A644E] disabled:opacity-60 text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors shadow-xs cursor-pointer disabled:cursor-not-allowed"
                  >
                    <span>
                      {signingIn
                        ? 'Signing in…'
                        : loading
                          ? 'Connecting…'
                          : companyMode === 'signin'
                            ? 'Sign in with Company ID'
                            : 'Create Company Account'}
                    </span>
                  </button>
                </form>
              )}

              {/* Tab 2: Phone Number (Local Server 6-digit OTP) */}
              {authMethod === 'phone' && !phoneOtpSentTo && (
                <form onSubmit={(e) => void handlePhoneSend(e)} noValidate className="space-y-3.5">
                  <div>
                    <label
                      htmlFor="auth-phone"
                      className="block text-xs font-medium text-[#394A43] dark:text-[#B4C5CE] mb-1"
                    >
                      Mobile number (with country code)
                    </label>
                    <input
                      id="auth-phone"
                      type="tel"
                      autoComplete="tel"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      placeholder="+91 98765 43210"
                      className="w-full h-10 px-3 rounded-xl bg-[#F4F7F5] dark:bg-[#17232A] text-sm text-[#0F1B17] dark:text-[#EEF3F1] placeholder:text-[#6B7C75] dark:placeholder:text-[#6E838E] border border-[#E1E7E4] dark:border-[#24343E] focus:border-[#0D7A5F] dark:focus:border-[#10B981] focus:bg-white dark:focus:bg-[#142027] focus:outline-none transition-colors tabular-nums"
                    />
                    <p className="mt-1.5 text-[11px] text-[#5A6B64] dark:text-[#8FA3AD]">
                      Include your country code (e.g. +91 or +1). Your local server issues a one-time 6-digit code.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={authBusy}
                    className="w-full h-11 px-4 rounded-xl bg-[#0D7A5F] hover:bg-[#0A644E] disabled:opacity-60 text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors shadow-xs cursor-pointer disabled:cursor-not-allowed"
                  >
                    <span>
                      {signingIn ? 'Issuing code…' : loading ? 'Connecting…' : 'Send Verification Code'}
                    </span>
                  </button>
                </form>
              )}

              {authMethod === 'phone' && phoneOtpSentTo && (
                <form onSubmit={(e) => void handlePhoneVerify(e)} noValidate className="space-y-3.5">
                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#EEF7F4] dark:bg-[#113129] text-xs">
                    <span className="text-[#0B2A21] dark:text-[#CCF3E6] truncate">
                      Code issued for <strong className="tabular-nums">{phoneOtpSentTo}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setOtpInput('');
                        onResetPhoneOtp();
                      }}
                      className="text-[#0D7A5F] dark:text-[#34D399] font-medium hover:underline shrink-0 cursor-pointer"
                    >
                      Change
                    </button>
                  </div>

                  {localOtpHint && (
                    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#F4F7F5] dark:bg-[#17232A] border border-[#DCE5E1] dark:border-[#24343E] text-xs">
                      <span className="text-[#394A43] dark:text-[#B4C5CE]">
                        Local server code:{' '}
                        <strong className="font-mono tracking-wider text-[#0F1B17] dark:text-[#EEF3F1]">
                          {localOtpHint}
                        </strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => setOtpInput(localOtpHint)}
                        className="text-[#0D7A5F] dark:text-[#34D399] font-medium hover:underline shrink-0 cursor-pointer"
                      >
                        Use code
                      </button>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="auth-otp"
                      className="block text-xs font-medium text-[#394A43] dark:text-[#B4C5CE] mb-1"
                    >
                      6-digit verification code
                    </label>
                    <input
                      id="auth-otp"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={otpInput}
                      onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456"
                      className="w-full h-10 px-3 rounded-xl bg-[#F4F7F5] dark:bg-[#17232A] text-sm tracking-[0.25em] font-mono text-[#0F1B17] dark:text-[#EEF3F1] placeholder:tracking-normal placeholder:font-sans placeholder:text-[#6B7C75] border border-[#E1E7E4] dark:border-[#24343E] focus:border-[#0D7A5F] dark:focus:border-[#10B981] focus:bg-white dark:focus:bg-[#142027] focus:outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="auth-phone-name"
                      className="block text-xs font-medium text-[#394A43] dark:text-[#B4C5CE] mb-1"
                    >
                      Display name (optional for new accounts)
                    </label>
                    <input
                      id="auth-phone-name"
                      type="text"
                      autoComplete="name"
                      value={phoneDisplayName}
                      onChange={(e) => setPhoneDisplayName(e.target.value)}
                      placeholder="Your name"
                      className="w-full h-10 px-3 rounded-xl bg-[#F4F7F5] dark:bg-[#17232A] text-sm text-[#0F1B17] dark:text-[#EEF3F1] placeholder:text-[#6B7C75] border border-[#E1E7E4] dark:border-[#24343E] focus:border-[#0D7A5F] dark:focus:border-[#10B981] focus:bg-white dark:focus:bg-[#142027] focus:outline-none transition-colors"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={authBusy}
                    className="w-full h-11 px-4 rounded-xl bg-[#0D7A5F] hover:bg-[#0A644E] disabled:opacity-60 text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors shadow-xs cursor-pointer disabled:cursor-not-allowed"
                  >
                    <span>{signingIn ? 'Verifying…' : 'Verify & Sign in'}</span>
                  </button>
                </form>
              )}

              {/* Secondary Preview Option */}
              <div className="my-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-[#E5EAE7] dark:bg-[#223039]" />
                <span className="text-[11px] font-medium text-[#6B7C75] dark:text-[#7D919B]">
                  or explore first
                </span>
                <span className="h-px flex-1 bg-[#E5EAE7] dark:bg-[#223039]" />
              </div>

              <button
                type="button"
                onClick={onTryDemo}
                className="w-full h-10 px-3 rounded-xl bg-white dark:bg-[#17232A] hover:bg-[#F8FAF9] dark:hover:bg-[#1D2D36] text-[#0F1B17] dark:text-[#EEF3F1] border border-[#DCE3DF] dark:border-[#24343E] font-medium text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <span>Try Interactive Demo</span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Right column: Interactive product preview card */}
          <div className="lg:col-span-7">
            <div className="rounded-2xl bg-white dark:bg-[#111B21] border border-[#DFE6E3] dark:border-[#223039] overflow-hidden shadow-[0_18px_50px_-24px_rgba(15,27,23,0.18)]">
              <div className="px-5 py-3.5 bg-[#F8FAF9] dark:bg-[#17232A] border-b border-[#E5E9E7] dark:border-[#223039] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {previewTab === 'groups' ? (
                    <div className="w-10 h-10 rounded-full bg-[#DCEFE8] dark:bg-[#143D33] text-[#0D7A5F] dark:text-[#34D399] flex items-center justify-center">
                      <Users className="w-5 h-5" aria-hidden="true" />
                    </div>
                  ) : (
                    <img
                      src={previewTab === 'media' ? DEMO_ASSETS.marcus : DEMO_ASSETS.maya}
                      alt={previewTab === 'media' ? 'Marcus Vance' : 'Maya Lin'}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  )}
                  <div>
                    <p className="text-sm font-semibold text-[#0F1B17] dark:text-[#EEF3F1]">
                      {previewTab === 'groups'
                        ? 'ARK Product Team'
                        : previewTab === 'media'
                          ? 'Marcus Vance'
                          : 'Maya Lin'}
                    </p>
                    <p className="text-xs text-[#0D7A5F] dark:text-[#34D399]">
                      {previewTab === 'groups' ? '4 members · 48h auto-delete' : 'Online · 48h auto-delete'}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-[#6B7C75] dark:text-[#8FA3AD] flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                  Local server
                </span>
              </div>

              <div className="ark-chat-wallpaper p-5 space-y-3 min-h-[340px] flex flex-col justify-center">
                {previewTab === 'direct' && (
                  <>
                    <div className="max-w-[78%] bg-white dark:bg-[#1C2A32] border border-[#E6EAE8] dark:border-[#24343E] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm text-[#0F1B17] dark:text-[#EEF3F1]">
                      <p>Snapped a quick reference from Elena’s studio desk for our warm neutral palette.</p>
                      <img
                        src={DEMO_ASSETS.studioPhoto}
                        alt="Sunlit modern architectural studio desk"
                        referrerPolicy="no-referrer"
                        className="mt-2.5 rounded-xl w-full h-44 object-cover"
                      />
                      <div className="mt-1.5 flex items-center justify-end text-[11px] text-[#6B7C75] dark:text-[#8FA3AD] tabular-nums">
                        2:18 PM
                      </div>
                    </div>

                    <div className="ml-auto max-w-[78%] bg-[#DDF5EC] dark:bg-[#0C4E3E] rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-sm text-[#0B2A21] dark:text-[#ECFDF5]">
                      <p>Love that lighting. Everything syncs over local WebSockets and purges cleanly after 48 hours.</p>
                      <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-[#3B6B5B] dark:text-[#9EDEC8] tabular-nums">
                        <span>2:19 PM</span>
                        <CheckCheck className="w-3.5 h-3.5 text-[#0EA5E9]" aria-hidden="true" />
                      </div>
                    </div>
                  </>
                )}

                {previewTab === 'groups' && (
                  <>
                    <div className="max-w-[80%] bg-white dark:bg-[#1C2A32] border border-[#E6EAE8] dark:border-[#24343E] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm text-[#0F1B17] dark:text-[#EEF3F1]">
                      <p className="text-xs font-semibold text-[#2563EB] dark:text-[#60A5FA] mb-1">Elena Rostova</p>
                      <p>Floorplan review wraps at 2 PM — dropping the final spec sheet right after.</p>
                      <div className="mt-1 text-right text-[11px] text-[#6B7C75] tabular-nums">1:42 PM</div>
                    </div>
                    <div className="max-w-[80%] bg-white dark:bg-[#1C2A32] border border-[#E6EAE8] dark:border-[#24343E] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm text-[#0F1B17] dark:text-[#EEF3F1]">
                      <p className="text-xs font-semibold text-[#0D7A5F] dark:text-[#34D399] mb-1">Marcus Vance</p>
                      <p>Local server sync is under 15ms and the 48-hour auto-delete worker removes both DB records and disk uploads.</p>
                      <div className="mt-1 text-right text-[11px] text-[#6B7C75] tabular-nums">1:45 PM</div>
                    </div>
                    <div className="ml-auto max-w-[78%] bg-[#DDF5EC] dark:bg-[#0C4E3E] rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-sm text-[#0B2A21] dark:text-[#ECFDF5]">
                      <p>Awesome — pinning this thread for release day.</p>
                      <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-[#3B6B5B] dark:text-[#9EDEC8] tabular-nums">
                        <span>1:46 PM</span>
                        <CheckCheck className="w-3.5 h-3.5 text-[#0EA5E9]" aria-hidden="true" />
                      </div>
                    </div>
                  </>
                )}

                {previewTab === 'media' && (
                  <>
                    <div className="ml-auto max-w-[78%] bg-[#DDF5EC] dark:bg-[#0C4E3E] rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-sm text-[#0B2A21] dark:text-[#ECFDF5]">
                      <div className="flex items-center gap-2.5 p-2 rounded-xl bg-[#0D7A5F]/10 dark:bg-black/25 mb-1.5">
                        <div className="w-9 h-9 rounded-lg bg-[#0D7A5F] text-white flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">Q4-Release-Checklist.pdf</p>
                          <p className="text-[11px] opacity-80">420 KB · Auto-deletes in 48h</p>
                        </div>
                      </div>
                      <p>Uploaded directly to local server storage.</p>
                      <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-[#3B6B5B] dark:text-[#9EDEC8] tabular-nums">
                        <span>11:12 AM</span>
                        <CheckCheck className="w-3.5 h-3.5 text-[#0EA5E9]" aria-hidden="true" />
                      </div>
                    </div>
                    <div className="max-w-[78%] bg-white dark:bg-[#1C2A32] border border-[#E6EAE8] dark:border-[#24343E] rounded-2xl rounded-tl-sm px-3.5 py-3 text-sm text-[#0F1B17] dark:text-[#EEF3F1]">
                      <div className="flex items-center gap-3 min-w-[230px]">
                        <div className="w-9 h-9 rounded-full bg-[#0D7A5F]/12 text-[#0D7A5F] dark:bg-[#10B981]/20 dark:text-[#34D399] flex items-center justify-center shrink-0">
                          <Play className="w-4 h-4 ml-0.5" aria-hidden="true" />
                        </div>
                        <div className="flex-1 flex items-center gap-[3px] h-6" aria-hidden="true">
                          {[35, 65, 50, 88, 60, 95, 45, 76, 82, 55, 70, 90, 48, 64].map((h, i) => (
                            <span
                              key={i}
                              style={{ height: `${h}%` }}
                              className={`flex-1 rounded-full ${i < 5 ? 'bg-[#0D7A5F] dark:bg-[#34D399]' : 'bg-[#CBD5D0] dark:bg-[#3A4D58]'}`}
                            />
                          ))}
                        </div>
                        <span className="text-xs text-[#5A6B64] dark:text-[#8FA3AD] tabular-nums">0:18</span>
                      </div>
                      <div className="mt-1.5 text-right text-[11px] text-[#6B7C75] tabular-nums">11:14 AM</div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
