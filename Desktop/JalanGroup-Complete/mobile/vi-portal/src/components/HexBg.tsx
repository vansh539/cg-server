import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Animated } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

interface HexProps {
  size: number;
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  delay: number;
  duration: number;
}

function FloatingHex({ size, top, left, right, bottom, delay, duration }: HexProps) {
  const y = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(y, { toValue: -10, duration, useNativeDriver: true }),
          Animated.timing(y, { toValue: 0, duration, useNativeDriver: true }),
        ])
      ).start();
    }, delay);
    return () => clearTimeout(timer);
  }, []);

  const h = size * 0.866;
  const pts = `${size / 2},2 ${size - 2},${h * 0.3} ${size - 2},${h * 0.7} ${size / 2},${h - 2} 2,${h * 0.7} 2,${h * 0.3}`;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { overflow: 'hidden' }]}>
      <Animated.View style={[{ position: 'absolute', top, left, right, bottom }, { transform: [{ translateY: y }] }]}>
        <Svg width={size} height={h} opacity={0.025}>
          <Polygon points={pts} fill="none" stroke="#C9A44A" strokeWidth="1.5" />
        </Svg>
      </Animated.View>
    </View>
  );
}

export function HexBg() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <FloatingHex size={120} top={20} right={-25} delay={0}   duration={4000} />
      <FloatingHex size={80}  bottom={90} left={-35} delay={800} duration={5000} />
      <FloatingHex size={160} top={160} right={-45} delay={400} duration={6000} />
    </View>
  );
}
