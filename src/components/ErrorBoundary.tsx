import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'An unexpected error occurred.',
    };
  }

  componentDidCatch(error: Error): void {
    console.error('ARK DM ErrorBoundary caught:', error);
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (this.state.hasError) {
      let displayDetail = this.state.errorMessage;
      try {
        const parsed = JSON.parse(this.state.errorMessage);
        if (parsed && parsed.error) {
          displayDetail = `${parsed.error}${parsed.path ? ` (${parsed.path})` : ''}`;
        }
      } catch {
        // Keep raw message
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F4F6F5] dark:bg-[#0B141A] p-6">
          <div className="max-w-md w-full bg-white dark:bg-[#17232A] border border-[#E5E9E7] dark:border-[#223039] rounded-2xl p-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" aria-hidden="true" />
            </div>
            <h1 className="font-display text-lg font-bold text-[#0F1B17] dark:text-[#EEF3F1] mb-2">
              Something went wrong
            </h1>
            <p className="text-sm text-[#5A6B64] dark:text-[#8FA3AD] mb-5 break-words">
              {displayDetail}
            </p>
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#0D7A5F] hover:bg-[#0A644E] text-white text-sm font-medium transition-colors"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
