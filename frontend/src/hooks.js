import {useEffect, useState} from 'react';
import {parseHash} from './router.js';

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash(globalThis.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(globalThis.location.hash));
      globalThis.scrollTo?.({top: 0});
    };
    globalThis.addEventListener('hashchange', onChange);
    return () => globalThis.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
