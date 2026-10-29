import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';

import 'main.dart';

/// Posts one step of the face check (`{'frame': base64}` or `{'cancel': true}`) and returns the server's answer.
typedef FaceSend = Future<Map<String, dynamic>> Function(Map<String, Object> body);

/// Shows the front camera after a QR scan and keeps sending frames until the
/// server has seen the card owner look at the camera and turn their head,
/// or the person presses «Цуцлах». The camera is released before [onDone].
class FaceCapture extends StatefulWidget {
  const FaceCapture({super.key, required this.name, required this.send, required this.onDone, required this.onError});

  final String name;
  final FaceSend send;
  final ValueChanged<Map<String, dynamic>> onDone;
  final ValueChanged<Object> onError;

  @override
  State<FaceCapture> createState() => _FaceCaptureState();
}

class _FaceCaptureState extends State<FaceCapture> {
  CameraController? _controller;
  String _prompt = 'Нүүрний камер нээж байна…';
  bool _cancelled = false;
  bool _finished = false;

  @override
  void initState() {
    super.initState();
    _run();
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  void _say(String text) {
    if (mounted && text != _prompt) setState(() => _prompt = text);
  }

  Future<void> _release() async {
    final controller = _controller;
    if (controller == null) return;
    if (mounted) setState(() => _controller = null);
    _controller = null;
    await controller.dispose();
  }

  void _finish(Map<String, dynamic> result) {
    if (_finished) return;
    _finished = true;
    widget.onDone(result);
  }

  Future<String> _shot() async {
    final file = await _controller!.takePicture();
    final bytes = await file.readAsBytes();
    unawaited(File(file.path).delete().then((_) {}, onError: (_) {}));
    return base64Encode(bytes);
  }

  Future<void> _run() async {
    try {
      final cameras = await availableCameras();
      final camera = cameras.firstWhere((item) => item.lensDirection == CameraLensDirection.front, orElse: () => cameras.first);
      final controller = CameraController(camera, ResolutionPreset.medium, enableAudio: false, imageFormatGroup: ImageFormatGroup.jpeg);
      await controller.initialize();
      if (!mounted || _cancelled) {
        await controller.dispose();
        return;
      }
      setState(() => _controller = controller);
      _say('Нүүрээ камерт харуулна уу');
      while (!_cancelled) {
        final frame = await _shot();
        if (_cancelled) return;
        final result = await widget.send({'frame': frame});
        if (_cancelled) return;
        if (result['pending'] != true) {
          _say('Шалгаж байна…');
          await _release();
          return _finish(result);
        }
        if (result['hint'] == 'turn') {
          _say('Толгойгоо зүүн, баруун тийш аажуухан эргүүлнэ үү');
        } else {
          _say(result['face'] == true ? 'Камер луу шууд харна уу' : 'Нүүрээ камерт харуулна уу');
        }
      }
    } catch (error) {
      await _release();
      if (!_cancelled && !_finished) {
        _finished = true;
        widget.onError(error is CameraException ? 'Нүүрний камер нээгдсэнгүй.' : error);
      }
    }
  }

  Future<void> _cancel() async {
    if (_cancelled || _finished) return;
    setState(() {
      _cancelled = true;
      _prompt = 'Цуцалж байна…';
    });
    await _release();
    try {
      await widget.send({'cancel': true});
    } catch (_) {
      // the check expires on the server by itself
    }
    _finish({'ok': false, 'reason': 'cancelled'});
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    final inset = MediaQuery.paddingOf(context);
    final size = controller?.value.previewSize;
    return ColoredBox(
      color: night,
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (controller != null && size != null)
            ClipRect(
              child: FittedBox(
                fit: BoxFit.cover,
                child: SizedBox(width: size.height, height: size.width, child: CameraPreview(controller)),
              ),
            ),
          const IgnorePointer(child: CustomPaint(painter: _OvalPainter())),
          Positioned(
            top: inset.top + 20,
            left: 16,
            right: 16,
            child: Text(
              'НҮҮР ШАЛГАЛТ · ${widget.name.toUpperCase()}',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70, fontSize: 13, fontWeight: FontWeight.w700, letterSpacing: 0.8),
            ),
          ),
          Positioned(
            left: 20,
            right: 20,
            bottom: inset.bottom + 24,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  _prompt,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w700, height: 1.25, shadows: [Shadow(blurRadius: 6)]),
                ),
                const SizedBox(height: 18),
                SizedBox(
                  width: double.infinity,
                  height: 54,
                  child: OutlinedButton.icon(
                    onPressed: _cancelled || _finished ? null : _cancel,
                    icon: const Icon(Icons.close),
                    label: const Text('Цуцлах', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.white,
                      backgroundColor: const Color(0x66000000),
                      side: const BorderSide(color: Color(0x99FFFFFF)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _OvalPainter extends CustomPainter {
  const _OvalPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final width = size.width * 0.68;
    final oval = Rect.fromCenter(center: Offset(size.width / 2, size.height * 0.42), width: width, height: width * 1.3);
    canvas.drawPath(
      Path.combine(PathOperation.difference, Path()..addRect(Offset.zero & size), Path()..addOval(oval)),
      Paint()..color = const Color(0x8C05090E),
    );
    canvas.drawOval(
      oval,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
