import React, { useEffect, useRef } from 'react';
import { Animated, TextStyle } from 'react-native';
import { colors, fonts } from '../theme';

interface Props {
  children: string;
  style?: TextStyle;
}

export function GoldShimmerText({ children, style }: Props) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration: 1800, useNativeDriver: false }),
        Animated.timing(progress, { toValue: 0, duration: 1800, useNativeDriver: false }),
      ])
    ).start();
  }, []);

  const color = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.txt, colors.viGoldLt],
  });

  return (
    <Animated.Text style={[{ fontFamily: fonts.cormorantItalic, color: colors.txt }, style, { color }]}>
      {children}
    </Animated.Text>
  );
}
