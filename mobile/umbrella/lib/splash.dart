import 'dart:math';

import 'package:flutter/material.dart';

const umbrellaRed = Color(0xFFD50000);
const umbrellaInk = Color(0xFF0B0B0D);

/// The 10-second UMBRELLA CORPORATION loading screen: the logo unfolds above the name while a bar fills.
class Splash extends StatefulWidget {
  const Splash({super.key, required this.onDone, this.duration = const Duration(seconds: 10)});

  final VoidCallback onDone;
  final Duration duration;

  @override
  State<Splash> createState() => _SplashState();
}

class _SplashState extends State<Splash> with TickerProviderStateMixin {
  late final AnimationController _progress = AnimationController(vsync: this, duration: widget.duration)
    ..addStatusListener((status) {
      if (status == AnimationStatus.completed) widget.onDone();
    })
    ..forward();
  late final AnimationController _spin = AnimationController(vsync: this, duration: const Duration(seconds: 18))..repeat();

  static const _steps = ['Системийг ачаалж байна', 'Аюулгүй холболт үүсгэж байна', 'Хэрэглэгчийн мэдээлэл шалгаж байна', 'Мэдрэгчүүдийг идэвхжүүлж байна', 'Бэлэн боллоо'];

  @override
  void dispose() {
    _progress.dispose();
    _spin.dispose();
    super.dispose();
  }

  Animation<double> _interval(double begin, double end, [Curve curve = Curves.easeOutCubic]) =>
      CurvedAnimation(parent: _progress, curve: Interval(begin, end, curve: curve));

  @override
  Widget build(BuildContext context) {
    final logoIn = _interval(0, 0.16, Curves.easeOutBack);
    final nameIn = _interval(0.1, 0.24);
    final subIn = _interval(0.18, 0.32);
    return Material(
      color: umbrellaInk,
      child: Stack(
        fit: StackFit.expand,
        children: [
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: RadialGradient(center: Alignment(0, -0.25), radius: 0.9, colors: [Color(0xFF2A0306), umbrellaInk]),
            ),
          ),
          SafeArea(
            child: Column(
              children: [
                const Spacer(flex: 3),
                AnimatedBuilder(
                  animation: Listenable.merge([_progress, _spin]),
                  builder: (context, _) {
                    final pulse = 1 + 0.025 * sin(_progress.value * pi * 10);
                    return Opacity(
                      opacity: logoIn.value.clamp(0.0, 1.0),
                      child: Transform.scale(
                        scale: (0.4 + 0.6 * logoIn.value) * pulse,
                        child: Transform.rotate(
                          angle: _spin.value * 2 * pi + (1 - logoIn.value) * -pi / 2,
                          child: Container(
                            width: 168,
                            height: 168,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              boxShadow: [BoxShadow(color: umbrellaRed.withValues(alpha: 0.35 * logoIn.value), blurRadius: 60, spreadRadius: 6)],
                            ),
                            child: Image.asset('assets/logo.png', filterQuality: FilterQuality.high),
                          ),
                        ),
                      ),
                    );
                  },
                ),
                const SizedBox(height: 40),
                FadeTransition(
                  opacity: nameIn,
                  child: SlideTransition(
                    position: Tween(begin: const Offset(0, 0.4), end: Offset.zero).animate(nameIn),
                    child: const Text(
                      'UMBRELLA',
                      style: TextStyle(color: Colors.white, fontSize: 40, fontWeight: FontWeight.w800, letterSpacing: 9),
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                FadeTransition(
                  opacity: subIn,
                  child: const Text(
                    'CORPORATION',
                    style: TextStyle(color: umbrellaRed, fontSize: 17, fontWeight: FontWeight.w700, letterSpacing: 11),
                  ),
                ),
                const Spacer(flex: 4),
                AnimatedBuilder(
                  animation: _progress,
                  builder: (context, _) {
                    final value = _progress.value;
                    final step = _steps[min(_steps.length - 1, (value * _steps.length).floor())];
                    return Padding(
                      padding: const EdgeInsets.fromLTRB(40, 0, 40, 36),
                      child: Column(
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text('$step…', style: const TextStyle(color: Color(0xFF9AA0A8), fontSize: 13, letterSpacing: 0.4)),
                              ),
                              Text('${(value * 100).round()}%', style: const TextStyle(color: Colors.white, fontSize: 13, fontFeatures: [FontFeature.tabularFigures()])),
                            ],
                          ),
                          const SizedBox(height: 10),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: LinearProgressIndicator(value: value, minHeight: 4, color: umbrellaRed, backgroundColor: const Color(0xFF26262B)),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
