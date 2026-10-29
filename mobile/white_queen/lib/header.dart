import 'dart:async';

import 'package:flutter/material.dart';

const _red = Color(0xFFFF1010);
const _redText = Color(0xFFFF2B3A);
const _line = Color(0xFF262626);

/// The UMBRELLA Corporation bar from the web app: logo, name and a red seven-segment clock.
class UmbrellaHeader extends StatefulWidget {
  const UmbrellaHeader({super.key});

  @override
  State<UmbrellaHeader> createState() => _UmbrellaHeaderState();
}

class _UmbrellaHeaderState extends State<UmbrellaHeader> {
  late DateTime _now = DateTime.now();
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _schedule();
  }

  void _schedule() {
    final now = DateTime.now();
    _tick = Timer(Duration(milliseconds: 1000 - now.millisecond), () {
      if (!mounted) return;
      setState(() => _now = DateTime.now());
      _schedule();
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    String two(int value) => value.toString().padLeft(2, '0');
    final time = '${two(_now.hour)}:${two(_now.minute)}:${two(_now.second)}';
    final date = '${two(_now.month)}/${two(_now.day)}/${two(_now.year % 100)}';
    return Container(
      padding: EdgeInsets.only(top: MediaQuery.paddingOf(context).top),
      decoration: const BoxDecoration(
        gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFF121212), Color(0xFF070707)]),
        border: Border(bottom: BorderSide(color: _line)),
      ),
      child: SizedBox(
        height: 64,
        child: Row(
          children: [
            const SizedBox(width: 12),
            Image.asset('assets/umbrella.png', width: 38, height: 38),
            const SizedBox(width: 9),
            const Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'UMBRELLA',
                  style: TextStyle(fontFamily: 'serif', color: Colors.white, fontSize: 17, fontWeight: FontWeight.w700, letterSpacing: 1.6, height: 1.1),
                ),
                SizedBox(height: 2),
                Text('CORPORATION', style: TextStyle(color: _redText, fontSize: 8.5, letterSpacing: 2.6)),
              ],
            ),
            const SizedBox(width: 12),
            const VerticalDivider(width: 1, thickness: 1, color: _line),
            Expanded(
              child: Semantics(
                label: '$time, $date',
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                  child: Column(
                    children: [
                      Expanded(flex: 30, child: _SegText(time)),
                      const SizedBox(height: 4),
                      Expanded(flex: 12, child: _SegText(date)),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SegText extends StatelessWidget {
  const _SegText(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return FittedBox(
      child: CustomPaint(size: Size(_SegPainter.widthOf(text), 100), painter: _SegPainter(text)),
    );
  }
}

/// Same geometry as the web clock (a 60×100 digit cell, 72 units per digit).
class _SegPainter extends CustomPainter {
  _SegPainter(this.text);

  final String text;

  static const _segments = {
    'a': [Offset(8, 6), Offset(52, 6)],
    'b': [Offset(54, 8), Offset(54, 48)],
    'c': [Offset(54, 52), Offset(54, 92)],
    'd': [Offset(8, 94), Offset(52, 94)],
    'e': [Offset(6, 52), Offset(6, 92)],
    'f': [Offset(6, 8), Offset(6, 48)],
    'g': [Offset(8, 50), Offset(52, 50)],
  };
  static const _digits = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];

  static double widthOf(String text) {
    var x = 12.0;
    for (final char in text.split('')) {
      x += RegExp(r'\d').hasMatch(char) ? 72 : 30;
    }
    return x;
  }

  Path _segment(Offset from, Offset to, double x0) {
    const h = 4.0;
    final points = from.dy == to.dy
        ? [from, from.translate(h, -h), to.translate(-h, -h), to, to.translate(-h, h), from.translate(h, h)]
        : [from, from.translate(h, h), to.translate(h, -h), to, to.translate(-h, -h), from.translate(-h, h)];
    return Path()..addPolygon(points.map((point) => point.translate(x0, 0)).toList(), true);
  }

  @override
  void paint(Canvas canvas, Size size) {
    final lit = Path();
    final dark = Path();
    var x = 0.0;
    for (final char in text.split('')) {
      final digit = int.tryParse(char);
      if (digit != null) {
        _segments.forEach((name, line) => (_digits[digit].contains(name) ? lit : dark).addPath(_segment(line[0], line[1], x), Offset.zero));
        x += 72;
      } else if (char == ':') {
        for (final y in [32.0, 68.0]) {
          lit.addPolygon([Offset(x + 9, y - 7), Offset(x + 16, y), Offset(x + 9, y + 7), Offset(x + 2, y)], true);
        }
        x += 30;
      } else if (char == '/') {
        lit.addPolygon([Offset(x + 14, 58), Offset(x + 20, 58), Offset(x + 8, 96), Offset(x + 2, 96)], true);
        x += 30;
      }
    }
    canvas.translate(10, 0);
    canvas.transform((Matrix4.identity()..setEntry(0, 1, -0.123)).storage);
    canvas.drawPath(dark, Paint()..color = _red.withValues(alpha: 0.07));
    canvas.drawPath(
      lit,
      Paint()
        ..color = const Color(0x80FF1010)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3),
    );
    canvas.drawPath(lit, Paint()..color = _red);
  }

  @override
  bool shouldRepaint(covariant _SegPainter oldDelegate) => oldDelegate.text != text;
}
