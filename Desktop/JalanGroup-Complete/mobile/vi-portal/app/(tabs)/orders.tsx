import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getOrders, getProducts, placeOrder } from '../../src/api';
import { colors, fonts } from '../../src/theme';
import { ScreenWrapper } from '../../src/components/ScreenWrapper';
import { TagBadge } from '../../src/components/TagBadge';

export default function OrdersScreen() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('');

  const { data: ordersData } = useQuery({ queryKey: ['portal-orders'], queryFn: getOrders });
  const { data: productsData } = useQuery({ queryKey: ['portal-products'], queryFn: getProducts });

  const { mutate: submitOrder, isPending } = useMutation({
    mutationFn: () => placeOrder({ product_id: productId, quantity: parseFloat(qty) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-orders'] });
      setShowForm(false);
      setQty('');
      setProductId('');
    },
    onError: () => Alert.alert('Failed', 'Could not place order'),
  });

  return (
    <ScreenWrapper>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10 }}>
        <Text style={styles.title}>Orders</Text>
        <TouchableOpacity style={styles.newBtn} onPress={() => setShowForm(true)}>
          <Text style={styles.newBtnText}>+ New Order</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={ordersData?.orders ?? []}
        keyExtractor={(item: any) => item.id}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 32 }}
        renderItem={({ item }: { item: any }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.orderNo}>#{item.order_number ?? item.id.slice(0, 8)}</Text>
              <Text style={styles.product}>
                {item.product_name} · {item.quantity} {item.unit}
              </Text>
              <Text style={styles.date}>{item.created_at?.slice(0, 10)}</Text>
            </View>
            <TagBadge
              label={item.status}
              variant={item.status === 'dispatched' ? 'done' : 'pending'}
            />
          </View>
        )}
      />

      <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>New Order</Text>
          <Text style={styles.modalLbl}>Product</Text>
          {(productsData?.products ?? []).map((p: any) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.productRow, productId === p.id && styles.productActive]}
              onPress={() => setProductId(p.id)}
            >
              <Text style={[styles.productName, productId === p.id && { color: colors.viGold }]}>
                {p.name}
              </Text>
              <Text style={styles.productPrice}>
                ₹{Number(p.price).toLocaleString('en-IN')}/{p.unit}
              </Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.modalLbl}>Quantity (tonnes)</Text>
          <TextInput
            style={styles.input}
            value={qty}
            onChangeText={setQty}
            keyboardType="numeric"
            placeholder="e.g. 2.5"
            placeholderTextColor={colors.txt3}
          />
          <TouchableOpacity
            style={[styles.submitBtn, (!productId || !qty) && { opacity: 0.5 }]}
            onPress={() => submitOrder()}
            disabled={isPending || !productId || !qty}
          >
            <Text style={styles.submitText}>{isPending ? '…' : 'Place Order'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title:        { fontFamily: fonts.cormorantItalic, fontSize: 28, color: colors.viGold },
  newBtn:       { backgroundColor: `${colors.viGold}18`, borderWidth: 1, borderColor: `${colors.viGold}40`, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  newBtnText:   { fontFamily: fonts.dmSansBold, fontSize: 11, color: colors.viGold },
  row:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.surf2 },
  orderNo:      { fontFamily: fonts.dmSansBold, fontSize: 12, color: colors.txt },
  product:      { fontFamily: fonts.dmSans, fontSize: 11, color: colors.txt2, marginTop: 2 },
  date:         { fontFamily: fonts.dmSans, fontSize: 9, color: colors.txt3, marginTop: 1 },
  modal:        { flex: 1, backgroundColor: colors.bg, padding: 24 },
  modalTitle:   { fontFamily: fonts.cormorantItalic, fontSize: 32, color: colors.viGold, marginBottom: 20 },
  modalLbl:     { fontFamily: fonts.dmSansBold, fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: colors.txt3, marginBottom: 8, marginTop: 16 },
  productRow:   { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.bdr, marginBottom: 6, flexDirection: 'row', justifyContent: 'space-between' },
  productActive:{ borderColor: `${colors.viGold}50`, backgroundColor: `${colors.viGold}10` },
  productName:  { fontFamily: fonts.dmSansBold, fontSize: 13, color: colors.txt },
  productPrice: { fontFamily: fonts.cormorantItalic, fontSize: 14, color: colors.txt2 },
  input:        { backgroundColor: colors.surf2, borderWidth: 1, borderColor: colors.bdr, borderRadius: 12, padding: 14, fontFamily: fonts.dmSans, fontSize: 14, color: colors.txt, marginBottom: 8 },
  submitBtn:    { backgroundColor: colors.viGold, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  submitText:   { fontFamily: fonts.dmSansBold, fontSize: 14, color: colors.bg },
  cancelBtn:    { alignItems: 'center', marginTop: 12 },
  cancelText:   { fontFamily: fonts.dmSans, fontSize: 13, color: colors.txt3 },
});
