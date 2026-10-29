import 'dart:async';

import 'package:flutter/material.dart';

import 'api.dart';
import 'header.dart';
import 'main.dart';

class PairingScreen extends StatefulWidget {
  const PairingScreen({super.key, required this.api, required this.onSignedIn});

  final Api api;
  final VoidCallback onSignedIn;

  @override
  State<PairingScreen> createState() => _PairingScreenState();
}

class _PairingScreenState extends State<PairingScreen> {
  Timer? _retry;
  bool _pending = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _attempt();
  }

  @override
  void dispose() {
    _retry?.cancel();
    super.dispose();
  }

  Future<void> _attempt() async {
    _retry?.cancel();
    try {
      final result = await widget.api.pair();
      if (!mounted) return;
      if (result == Pairing.signedIn) return widget.onSignedIn();
      setState(() {
        _pending = true;
        _error = '';
      });
    } on ApiError catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Сервер олдсонгүй. Утасны интернэт холболтоо шалгана уу.');
      }
    }
    if (mounted) _retry = Timer(const Duration(seconds: 3), _attempt);
  }

  Future<void> _editServer() async {
    final field = TextEditingController(text: widget.api.base);
    final value = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Серверийн хаяг'),
        content: TextField(controller: field, keyboardType: TextInputType.url, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Болих')),
          FilledButton(onPressed: () => Navigator.pop(context, field.text), child: const Text('Хадгалах')),
        ],
      ),
    );
    field.dispose();
    if (value == null || value.trim().isEmpty) return;
    await widget.api.setServer(value);
    _attempt();
  }

  @override
  Widget build(BuildContext context) {
    final code = widget.api.pairingCode;
    return Scaffold(
      backgroundColor: const Color(0xFFF3F5F8),
      body: Column(
        children: [
          const UmbrellaHeader(),
          Expanded(child: SafeArea(top: false, child: _body(code))),
        ],
      ),
    );
  }

  Widget _body(String? code) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: Column(
          children: [
            GestureDetector(
              onLongPress: _editServer,
              child: ClipRRect(borderRadius: BorderRadius.circular(28), child: Image.asset('assets/queen.png', height: 112)),
            ),
            const SizedBox(height: 18),
            const Text(
              'WHITE QUEEN',
              style: TextStyle(color: ink, fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: 6),
            ),
            const SizedBox(height: 28),
            if (_pending && code != null) ...[
              const Text(
                'Админ энэ утсыг зөвшөөрөхийг хүлээж байна',
                textAlign: TextAlign.center,
                style: TextStyle(color: ink, fontSize: 17, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 14),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: const Color(0xFFDDE3EA)),
                ),
                child: Text(
                  code,
                  style: const TextStyle(color: ink, fontSize: 40, fontWeight: FontWeight.w700, letterSpacing: 12),
                ),
              ),
              const SizedBox(height: 18),
              const Text(
                'Компьютер дээр админ эрхээр White Queen хуудсыг нээж, «Станцын төхөөрөмж» хэсэгт энэ кодтой хүсэлтийг «Зөвшөөрөх» дарна уу. Зөвшөөрсний дараа апп өөрөө нэвтэрнэ.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Color(0xFF6A7785), height: 1.5),
              ),
            ] else if (_error.isEmpty) ...[
              const CircularProgressIndicator(color: steel),
              const SizedBox(height: 16),
              const Text('Нэвтэрч байна…', style: TextStyle(color: Color(0xFF6A7785))),
            ],
            if (_error.isNotEmpty) ...[
              const SizedBox(height: 18),
              Text(
                _error,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Color(0xFFC62828), height: 1.5),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
