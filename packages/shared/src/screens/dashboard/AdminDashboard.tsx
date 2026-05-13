import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { signOut } from '../../services/auth';

export default function AdminDashboard(): React.JSX.Element {
  async function handleSignOut(): Promise<void> {
    try {
      await signOut();
    } catch {
      // handled by auth state change
    }
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Panel Administrador</Text>
        <TouchableOpacity onPress={() => void handleSignOut()}>
          <Text style={styles.signOutText}>Cerrar sesión</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Resumen General</Text>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>—</Text>
            <Text style={styles.statLabel}>Pedidos Dañados</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>—</Text>
            <Text style={styles.statLabel}>Reportes Generados</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>—</Text>
            <Text style={styles.statLabel}>Áreas Activas</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#1a1a2e',
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  signOutText: { color: '#aaa', fontSize: 14 },
  section: { margin: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12, color: '#1a1a2e' },
  statsRow: { flexDirection: 'row', gap: 12 },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  statValue: { fontSize: 28, fontWeight: 'bold', color: '#1a1a2e' },
  statLabel: { fontSize: 12, color: '#666', marginTop: 4, textAlign: 'center' },
});
