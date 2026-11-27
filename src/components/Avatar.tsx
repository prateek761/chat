import { useState } from 'react';
import { Users } from 'lucide-react';
import { getInitials } from '../utils/chatLogic';

interface AvatarProps {
  src?: string;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  isGroup?: boolean;
  isOnline?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'w-7 h-7 text-[11px]',
  sm: 'w-9 h-9 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-20 h-20 text-xl',
};

const PALETTE = [
  'bg-[#DCEFE8] text-[#0C5A46] dark:bg-[#143D33] dark:text-[#86E5C5]',
  'bg-[#E3EBF5] text-[#1D4774] dark:bg-[#1B2F47] dark:text-[#9BC5F2]',
  'bg-[#EFE7DC] text-[#6E481B] dark:bg-[#3B2C1B] dark:text-[#E6C091]',
  'bg-[#EAE4F2] text-[#4C3273] dark:bg-[#2F2345] dark:text-[#CBB5EC]',
  'bg-[#E4ECEA] text-[#28514A] dark:bg-[#1D3532] dark:text-[#9ED3C8]',
];

function getToneIndex(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % PALETTE.length;
  }
  return Math.abs(hash) % PALETTE.length;
}

export function Avatar({ src, name, size = 'md', isGroup = false, isOnline = false }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;
  const tone = PALETTE[getToneIndex(name)];

  return (
    <div className="relative inline-flex shrink-0">
      {showImage ? (
        <img
          src={src}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className={`${SIZE_CLASSES[size]} rounded-full object-cover ring-1 ring-black/5 dark:ring-white/10`}
        />
      ) : (
        <div
          aria-hidden="true"
          className={`${SIZE_CLASSES[size]} ${tone} rounded-full flex items-center justify-center font-display font-semibold select-none ring-1 ring-black/5 dark:ring-white/10`}
        >
          {isGroup ? (
            <Users className={size === 'xl' ? 'w-8 h-8' : size === 'lg' ? 'w-6 h-6' : 'w-4 h-4'} />
          ) : (
            getInitials(name)
          )}
        </div>
      )}

      {isOnline && !isGroup && (
        <span
          title="Online"
          className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#16A34A] ring-2 ring-white dark:ring-[#111B21]"
        />
      )}
    </div>
  );
}
