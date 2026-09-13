import { Spring } from '@afilmory/utils';
import { m } from 'motion/react';
import type { Map } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { validLocation } from '../../viewer/metadata';
import { Icon } from '../ui/Icon';
import { LinearDivider } from '../ui/LinearDivider';
import { useReducedMotion } from '../ui/useReducedMotion';

export function MapControls({ map, disabled }: { map: Map | null; disabled: boolean }) {
  const reduced = useReducedMotion();
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef(0);
  useEffect(() => {
    setLocating(false); setMessage('');
    return () => { request.current++; };
  }, [map, disabled]);
  const zoom = (step: number) => {
    if (map && !disabled) map.easeTo({ zoom: Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + step)), duration: reduced ? 0 : 300 });
  };
  const compass = () => { if (map && !disabled) map.easeTo({ bearing: 0, pitch: 0, duration: reduced ? 0 : 500 }); };
  const geolocate = () => {
    if (!map || disabled || locating) return;
    if (!navigator.geolocation) { setMessage('此浏览器不支持定位。'); return; }
    const id = ++request.current;
    setLocating(true); setMessage('');
    const failed = () => { if (id === request.current) { setLocating(false); setMessage('无法获取当前位置，请检查定位权限后重试。'); } };
    try {
      navigator.geolocation.getCurrentPosition(position => {
        if (id !== request.current) return;
        const { longitude, latitude } = position.coords;
        if (!validLocation({ longitude, latitude })) { failed(); return; }
        setLocating(false);
        map.flyTo({ center: [longitude, latitude], zoom: 14, duration: reduced ? 0 : 1000 });
      }, failed, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    } catch { failed(); }
  };
  const button = (label: string, icon: string, onClick: () => void, busy = false) => <m.button type="button" aria-label={label} title={label}
    disabled={disabled || !map || busy} aria-busy={busy || undefined} onClick={onClick}
    whileHover={reduced ? undefined : { scale: 1.1 }} whileTap={reduced ? undefined : { scale: .95 }} transition={Spring.presets.snappy}>
    <Icon name={icon} />
  </m.button>;
  return <m.div className="map-controls" role="group" aria-label="地图控件" initial={reduced ? false : { opacity: 0, x: -20 }}
    animate={{ opacity: 1, x: 0 }} transition={Spring.presets.smooth}>
    <div className="map-control-glass">{button('放大地图', 'add', () => zoom(1))}<LinearDivider />{button('缩小地图', 'minimize', () => zoom(-1))}</div>
    <div className="map-control-glass">{button('重置地图方向和倾斜', 'navigation', compass)}</div>
    <div className="map-control-glass">{button('定位当前位置', 'location', geolocate, locating)}</div>
    {message && <p className="map-geolocation-status" role="status">{message}</p>}
  </m.div>;
}
