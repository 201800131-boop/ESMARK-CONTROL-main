import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { signOut } from '../../services/auth';

export default function AreaDashboard(): React.JSX.Element {
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
        <Text style={styles.headerTitle}>Panel de Área</Text>
        <TouchableOpacity onPress={() => void handleSignOut()}>
          <Text style={styles.signOutText}>Cerrar sesión</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mis Pedidos Dañados</Text>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No hay pedidos registrados aún.</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Tarjetas Trello</Text>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Sin tarjetas asignadas.</Text>
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
  emptyState: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  emptyText: { color: '#999', fontSize: 14 },
});
