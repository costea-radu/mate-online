import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export function useFavorites() {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) { setFavorites(new Set()); return; }
    supabase.from('favorites').select('content_id').eq('user_id', user.id)
      .then(({ data }) => {
        if (data) setFavorites(new Set(data.map(f => f.content_id)));
      });
  }, [user?.id]);

  async function toggle(contentId) {
    if (!user) return;
    const isFav = favorites.has(contentId);
    setFavorites(prev => {
      const next = new Set(prev);
      if (isFav) next.delete(contentId); else next.add(contentId);
      return next;
    });
    if (isFav) {
      await supabase.from('favorites').delete().eq('user_id', user.id).eq('content_id', contentId);
    } else {
      await supabase.from('favorites').insert({ user_id: user.id, content_id: contentId });
    }
  }

  return { favorites, toggle, loading };
}
