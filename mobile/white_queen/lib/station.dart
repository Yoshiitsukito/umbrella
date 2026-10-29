import 'dart:async';
import 'dart:convert';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import 'api.dart';
import 'face.dart';
import 'header.dart';
import 'main.dart';

const _good = Color(0xFF1F8A52);
const _bad = Color(0xFFC62828);
const _ready = 'QR кодоо камерт үзүүлнэ үү';

const _reasons = {
  'expired': 'QR-ийн хугацаа дууссан. Утсан дээрх кодоо шинэчилнэ үү.',
  'replay': 'Энэ QR аль хэдийн уншигдсан. Шинэ код гарахыг хүлээнэ үү.',
  'unknown': 'QR танигдсангүй эсвэл эрх түдгэлзсэн.',
  'invalid': 'QR буруу байна.',
  'bad': 'QR буруу байна.',
  'cooldown': 'Саяхан бүртгэгдсэн. 1 минутын дараа дахин уншуулна уу.',
  'rest': 'Амралтын хугацаа. ID карт түдгэлзсэн байна.',
  'nophoto': 'ID карт дээр нүүрний зураг алга. Админд хандана уу.',
  'mismatch': 'Нүүр ID картын зурагтай таарсангүй.',
  'timeout': 'Нүүр шалгах хугацаа дууссан. QR-ээ дахин уншуулна уу.',
};

class _FaceJob {
  _FaceJob(this.name, this.challenge);

  final String name;
  final String challenge;
  final Completer<Map<String, dynamic>> result = Completer();
}

class ScanOutcome {
  ScanOutcome({required this.ok, required this.title, required this.headline, this.detail = '', this.photo, this.leaving = false});

  final bool ok;
  final bool leaving;
  final String title;
  final String headline;
  final String detail;
  final String? photo;
}

class StationScreen extends StatefulWidget {
  const StationScreen({super.key, required this.api, required this.onSignedOut});

  final Api api;
  final VoidCallback onSignedOut;

  @override
  State<StationScreen> createState() => _StationScreenState();
}

class _StationScreenState extends State<StationScreen> with WidgetsBindingObserver {
  late final MobileScannerController _camera = MobileScannerController(
    formats: const [BarcodeFormat.qrCode],
    facing: widget.api.frontCamera ? CameraFacing.front : CameraFacing.back,
  );
  final AudioPlayer _player = AudioPlayer();
  final List<String> _queue = [];
  Timer? _poll;
  Timer? _resultTimer;
  int? _seq;
  bool _speaking = false;
  bool _checking = false;
  String _lastToken = '';
  DateTime _lastTokenAt = DateTime.fromMillisecondsSinceEpoch(0);
  String _status = _ready;
  String _error = '';
  ScanOutcome? _outcome;
  _FaceJob? _face;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WakelockPlus.enable();
    _refresh();
    _poll = Timer.periodic(const Duration(seconds: 4), (_) => _refresh());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    _resultTimer?.cancel();
    _camera.dispose();
    _player.dispose();
    WakelockPlus.disable();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) WakelockPlus.enable();
  }

  Future<void> _refresh() async {
    try {
      final data = await widget.api.getJson('/api/whiteking/state${_seq == null ? '' : '?after=$_seq'}');
      _seq = (data['seq'] as num?)?.toInt() ?? _seq;
      if (data['voice'] == true) {
        for (final item in (data['announcements'] as List? ?? const [])) {
          final text = (item as Map)['text']?.toString() ?? '';
          if (text.isNotEmpty) _say(text);
        }
      }
      if (_error.isNotEmpty && mounted) setState(() => _error = '');
    } on ApiError catch (error) {
      if (error.status == 401) return _signedOut();
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Сервер хайж байна… Компьютер асаалттай, утас ижил Wi-Fi-д холбогдсон эсэхийг шалгана уу.');
    }
  }

  void _signedOut() {
    _poll?.cancel();
    widget.onSignedOut();
  }

  void _say(String text) {
    _queue.add(text);
    _pump();
  }

  Future<void> _pump() async {
    if (_speaking || _queue.isEmpty) return;
    _speaking = true;
    final text = _queue.removeAt(0);
    try {
      final audio = await widget.api.speech(text);
      final done = _player.onPlayerComplete.first;
      await _player.play(BytesSource(audio));
      await done.timeout(Duration(seconds: 20 + text.length ~/ 4));
    } catch (_) {
      if (mounted) setState(() => _error = 'Мэдэгдлийг хоолойгоор хэлж чадсангүй.');
    } finally {
      _speaking = false;
      _pump();
    }
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    String? token;
    for (final code in capture.barcodes) {
      if (code.rawValue?.isNotEmpty ?? false) {
        token = code.rawValue;
        break;
      }
    }
    if (token == null || _checking) return;
    final now = DateTime.now();
    if (token == _lastToken && now.difference(_lastTokenAt) < const Duration(seconds: 30)) return;
    _lastToken = token;
    _lastTokenAt = now;
    setState(() {
      _checking = true;
      _status = 'Шалгаж байна…';
    });
    var pause = const Duration(milliseconds: 2500);
    try {
      var result = await widget.api.postJson('/api/whiteking/scan', {'token': token});
      if (result['step'] == 'face') {
        result = await _checkFace(result['name']?.toString() ?? '', result['challenge'].toString());
      }
      if (result['ok'] != true) _lastToken = '';
      if (result['reason'] == 'cancelled') {
        pause = const Duration(milliseconds: 600);
      } else if (result['ok'] == true) {
        final person = Map<String, dynamic>.from(result['person'] as Map);
        final leaving = result['state'] != 'in';
        final clock = DateTime.now();
        final at = '${clock.hour.toString().padLeft(2, '0')}:${clock.minute.toString().padLeft(2, '0')}';
        _show(
          ScanOutcome(
            ok: true,
            leaving: leaving,
            title: '${leaving ? 'Гарсан цаг бүртгэгдлээ' : 'Ирц бүртгэгдлээ'} · $at',
            headline: person['name']?.toString() ?? '',
            detail: (person['title']?.toString().isNotEmpty ?? false) ? person['title'].toString() : person['idNumber']?.toString() ?? '',
            photo: person['photo']?.toString(),
          ),
        );
        final speech = result['speech']?.toString() ?? '';
        if (speech.isNotEmpty) _say(speech);
      } else {
        final name = result['name']?.toString();
        _show(ScanOutcome(ok: false, title: name == null ? 'Бүртгэгдсэнгүй' : 'Бүртгэгдсэнгүй · $name', headline: result['error']?.toString() ?? _reasons[result['reason']] ?? 'Татгалзсан'));
      }
    } on ApiError catch (error) {
      if (error.status == 401) return _signedOut();
      _show(ScanOutcome(ok: false, title: 'Бүртгэгдсэнгүй', headline: error.message));
    } catch (_) {
      _show(ScanOutcome(ok: false, title: 'Бүртгэгдсэнгүй', headline: 'Сервертэй холбогдож чадсангүй.'));
    } finally {
      await _endFace();
    }
    await Future<void>.delayed(pause);
    if (mounted) {
      setState(() {
        _checking = false;
        _status = _ready;
      });
    }
  }

  /// Hands the camera over to [FaceCapture] (front camera) until the server decides the face check.
  Future<Map<String, dynamic>> _checkFace(String name, String challenge) async {
    await _camera.stop();
    if (!mounted) throw ApiError(0, 'Станц хаагдсан.');
    final job = _FaceJob(name, challenge);
    setState(() => _face = job);
    return job.result.future;
  }

  Future<void> _endFace() async {
    if (_face == null) return;
    if (mounted) setState(() => _face = null);
    try {
      await _camera.start();
    } on MobileScannerException {
      // the scanner's errorBuilder offers a retry
    }
  }

  void _show(ScanOutcome outcome) {
    if (!mounted) return;
    _resultTimer?.cancel();
    setState(() => _outcome = outcome);
    _resultTimer = Timer(const Duration(milliseconds: 4500), () {
      if (mounted) setState(() => _outcome = null);
    });
  }

  Future<void> _flip() async {
    await _camera.switchCamera();
    await widget.api.setFrontCamera(!widget.api.frontCamera);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: night,
      body: Column(
        children: [
          const UmbrellaHeader(),
          Expanded(
            child: MediaQuery.removePadding(context: context, removeTop: true, child: _stage(context)),
          ),
        ],
      ),
    );
  }

  Widget _stage(BuildContext context) {
    final inset = MediaQuery.paddingOf(context);
    return Stack(
      fit: StackFit.expand,
      children: [
        MobileScanner(
          controller: _camera,
          fit: BoxFit.cover,
          onDetect: _onDetect,
          errorBuilder: (context, error) => _CameraError(error: error, onRetry: () => _camera.start()),
        ),
        const IgnorePointer(child: CustomPaint(painter: _FramePainter())),
        if (_error.isNotEmpty)
          Positioned(
            top: inset.top + 12,
            left: 16,
            right: 16,
            child: Text(
              _error,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFFFFB4B4), fontSize: 14, shadows: [Shadow(blurRadius: 4)]),
            ),
          ),
        if (_outcome != null)
          Positioned(
            top: inset.top + 16,
            left: 14,
            right: 14,
            child: _ResultCard(outcome: _outcome!),
          ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: Container(
            padding: EdgeInsets.fromLTRB(18, 28, 18, 18 + inset.bottom),
            decoration: const BoxDecoration(
              gradient: LinearGradient(begin: Alignment.bottomCenter, end: Alignment.topCenter, colors: [Color(0xD9050A0E), Color(0x00050A0E)]),
            ),
            child: Row(
              children: [
                Expanded(
                  child: ValueListenableBuilder<MobileScannerState>(
                    valueListenable: _camera,
                    builder: (context, state, _) => Text(
                      _checking ? _status : (state.isRunning ? _ready : 'Камер асааж байна…'),
                      style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w600),
                    ),
                  ),
                ),
                _RoundButton(icon: Icons.cameraswitch_outlined, label: 'Камер солих', onTap: _flip),
              ],
            ),
          ),
        ),
        if (_face case final job?)
          FaceCapture(
            name: job.name,
            send: (body) => widget.api.postJson('/api/whiteking/face', {'challenge': job.challenge, ...body}),
            onDone: job.result.complete,
            onError: (error) => job.result.completeError(error is String ? ApiError(0, error) : error),
          ),
      ],
    );
  }
}

class _ResultCard extends StatelessWidget {
  const _ResultCard({required this.outcome});

  final ScanOutcome outcome;

  @override
  Widget build(BuildContext context) {
    final accent = !outcome.ok ? _bad : (outcome.leaving ? steel : _good);
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 16, 18, 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border(left: BorderSide(color: accent, width: 6)),
        boxShadow: const [BoxShadow(color: Color(0x59000000), blurRadius: 30, offset: Offset(0, 10))],
      ),
      child: Row(
        children: [
          if (outcome.ok) ...[_Avatar(photo: outcome.photo, name: outcome.headline), const SizedBox(width: 14)],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  outcome.title.toUpperCase(),
                  style: TextStyle(color: accent, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.6),
                ),
                const SizedBox(height: 2),
                Text(
                  outcome.headline,
                  style: const TextStyle(color: ink, fontSize: 21, fontWeight: FontWeight.w700, height: 1.2),
                ),
                if (outcome.detail.isNotEmpty) Text(outcome.detail, style: const TextStyle(color: Color(0xFF6A7785), fontSize: 13)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.photo, required this.name});

  final String? photo;
  final String name;

  @override
  Widget build(BuildContext context) {
    final value = photo ?? '';
    final comma = value.indexOf(',');
    Widget child = Text(
      name.trim().split(RegExp(r'\s+')).where((part) => part.isNotEmpty).take(2).map((part) => part[0]).join().toUpperCase(),
      style: const TextStyle(color: steel, fontSize: 20, fontWeight: FontWeight.w700),
    );
    if (value.startsWith('data:image') && comma > 0) {
      try {
        child = Image.memory(base64Decode(value.substring(comma + 1)), fit: BoxFit.cover, width: 58, height: 58);
      } on FormatException {
        // keep the initials
      }
    }
    return ClipOval(
      child: Container(width: 58, height: 58, color: const Color(0xFFE4E9EF), alignment: Alignment.center, child: child),
    );
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: Material(
        color: Colors.white.withValues(alpha: 0.14),
        shape: const CircleBorder(side: BorderSide(color: Color(0x59FFFFFF))),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(width: 52, height: 52, child: Icon(icon, color: Colors.white, size: 26)),
        ),
      ),
    );
  }
}

class _CameraError extends StatelessWidget {
  const _CameraError({required this.error, required this.onRetry});

  final MobileScannerException error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final denied = error.errorCode == MobileScannerErrorCode.permissionDenied;
    return ColoredBox(
      color: night,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.no_photography_outlined, color: Colors.white70, size: 56),
              const SizedBox(height: 16),
              Text(
                denied ? 'Камерын зөвшөөрөл олгоогүй байна. Тохиргооноос White Queen-д камер ашиглахыг зөвшөөрнө үү.' : 'Камер нээгдсэнгүй.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white, fontSize: 16),
              ),
              const SizedBox(height: 16),
              OutlinedButton(onPressed: onRetry, child: const Text('Дахин оролдох')),
            ],
          ),
        ),
      ),
    );
  }
}

class _FramePainter extends CustomPainter {
  const _FramePainter();

  @override
  void paint(Canvas canvas, Size size) {
    final side = (size.width * 0.72).clamp(0.0, size.height * 0.62);
    final rect = Rect.fromCenter(center: Offset(size.width / 2, size.height * 0.46), width: side, height: side);
    final hole = RRect.fromRectAndRadius(rect, const Radius.circular(18));
    canvas.drawPath(
      Path.combine(PathOperation.difference, Path()..addRect(Offset.zero & size), Path()..addRRect(hole)),
      Paint()..color = const Color(0x6B05090E),
    );
    final pen = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 5
      ..strokeCap = StrokeCap.round;
    const arm = 40.0;
    final corners = [
      [rect.topLeft, const Offset(1, 0), const Offset(0, 1)],
      [rect.topRight, const Offset(-1, 0), const Offset(0, 1)],
      [rect.bottomLeft, const Offset(1, 0), const Offset(0, -1)],
      [rect.bottomRight, const Offset(-1, 0), const Offset(0, -1)],
    ];
    for (final corner in corners) {
      final point = corner[0];
      canvas.drawLine(point, point + corner[1] * arm, pen);
      canvas.drawLine(point, point + corner[2] * arm, pen);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
