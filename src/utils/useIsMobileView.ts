import { useEffect, useState } from 'react';
import { useWorkoutStore } from '../store/useWorkoutStore';

export function useIsMobileView(): boolean {
  const viewportMode = useWorkoutStore((s) => s.viewportMode);
  const [windowIsNarrow, setWindowIsNarrow] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    const onResize = () => setWindowIsNarrow(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (viewportMode === 'mobile') return true;
  if (viewportMode === 'desktop') return false;
  return windowIsNarrow;
}
