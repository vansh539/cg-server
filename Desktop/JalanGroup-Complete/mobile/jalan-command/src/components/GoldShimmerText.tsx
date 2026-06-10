import React, { useEffect } from 'react';
import { TextStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import { colors, fonts } from '../theme';

interface Props {
  children: string;
  style?: TextStyle;
}

export function GoldShimmerText({ children, style }: Props) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1800 }),
        withTiming(0, { duration: 1800 })
      ),
      -1,
      false
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [colors.txt, colors.viGoldLt]),
  }));

  return (
    <Animated.Text style={[styles.base, style, animStyle]}>
      {children}
    </Animated.Text>
  );
}

const styles = { base: { fontFamily: fonts.cormorantItalic, color: colors.txt } };
