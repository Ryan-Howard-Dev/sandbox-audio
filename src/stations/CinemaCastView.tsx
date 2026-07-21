import React, { useEffect, useState } from 'react';
import {
  getLastCinemaCastPayload,
  subscribeCinemaCast,
  type CinemaCastPayload,
} from '../cinemaCast';
import CinemaCastContent from './CinemaCastContent';

export default function CinemaCastView() {
  const [payload, setPayload] = useState<CinemaCastPayload>(getLastCinemaCastPayload);

  useEffect(() => subscribeCinemaCast(setPayload), []);

  return (
    <div className="h-dvh w-full">
      <CinemaCastContent payload={payload} />
    </div>
  );
}
