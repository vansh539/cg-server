import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Polygon } from 'react-native-svg';

interface HexProps {
  size: number;
  top?: number | string;
  left?: number | string;
  right?: number | string;
  bottom?: number | string;
  delay: number;
  duration: number;
}

function FloatingHex({ size, top, left, right, bottom, delay, duration }: HexProps) {
  const y = useSharedValue(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      y.value = withRepeat(
        withSequence(withTiming(-10, { duration }), withTiming(0, { duration })),
        -1,
        false
      );
    }, delay);
    return () => clearTimeout(timer);
  }, []);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const h = size * 0.866;
  const pts = `${size / 2},2 ${size - 2},${h * 0.3} ${size - 2},${h * 0.7} ${size / 2},${h - 2} 2,${h * 0.7} 2,${h * 0.3}`;

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { overflow: 'hidden' }]}
    >
      <Animated.View style={[{ position: 'absolute', top, left, right, bottom }, animStyle]}>
        <Svg width={size} height={h} opacity={0.025}>
          <Polygon points={pts} fill="none" stroke="#C9A44A" strokeWidth="1.5" />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

export function HexBg() {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <FloatingHex size={120} top={20} right={-25} delay={0}   duration={4000} />
      <FloatingHex size={80}  bottom={90} left={-35} delay={800} duration={5000} />
      <FloatingHex size={160} top="40%" right={-45} delay={400} duration={6000} />
    </View>
  );
}
