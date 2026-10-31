import {registerRoot, Composition, AbsoluteFill, useCurrentFrame, interpolate} from 'remotion';
const Smoke = () => { const f = useCurrentFrame(); const o = interpolate(f,[0,30],[0,1],{extrapolateRight:'clamp'});
  return <AbsoluteFill style={{background:'#0A1419',color:'#AAE106',justifyContent:'center',alignItems:'center',fontSize:180,fontFamily:'Paperlogy, sans-serif',opacity:o}}>1968</AbsoluteFill>; };
const Root = () => <Composition id="Smoke" component={Smoke} durationInFrames={90} fps={30} width={1080} height={1920}/>;
registerRoot(Root);
