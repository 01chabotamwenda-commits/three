import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { genId, ProfileField, ThemeOverride, useApp } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';
import { confirmDialog, doubleConfirmDialog } from '@/utils/alert';

function getFieldValue(fields: ProfileField[], ...keywords: string[]): string | undefined {
  for (const kw of keywords) {
    const lower = kw.toLowerCase();
    const match = fields.find(f => f.label.toLowerCase().includes(lower));
    if (match?.value?.trim()) return match.value.trim();
  }
  return undefined;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) ? (v as string[]).join(', ') : '');

function GroupedFieldView({
  label,
  fields,
  isLast,
  colors,
}: {
  label: string;
  fields: ProfileField[];
  isLast?: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  const isGroup = fields.length > 1;
  return (
    <View style={{
      paddingVertical: 12,
      borderBottomWidth: isLast ? 0 : 1,
      borderBottomColor: colors.divider,
    }}>
      <Text style={{
        fontSize: 10,
        fontFamily: 'Inter_600SemiBold',
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        marginBottom: isGroup ? 8 : 3,
      }}>
        {label}
      </Text>
      {isGroup ? (
        <View style={{ gap: 5 }}>
          {fields.map(f => (
            <View key={f.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <View style={{
                width: 5, height: 5, borderRadius: 3,
                backgroundColor: colors.primary,
                marginTop: 7, flexShrink: 0,
              }} />
              <Text style={{
                fontSize: 13,
                fontFamily: 'Inter_500Medium',
                color: colors.text,
                lineHeight: 20,
                flex: 1,
              }}>
                {f.value}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={{
          fontSize: 14,
          fontFamily: 'Inter_500Medium',
          color: colors.text,
          lineHeight: 20,
        }}>
          {fields[0].value}
        </Text>
      )}
    </View>
  );
}

function FieldEditRow({
  field,
  onChange,
  onDelete,
  colors,
}: {
  field: ProfileField;
  onChange: (id: string, key: 'label' | 'value', text: string) => void;
  onDelete: (id: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const inputBase = {
    backgroundColor: colors.muted,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14 as const,
    fontFamily: 'Inter_400Regular' as const,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  };
  return (
    <View style={{
      marginBottom: 12,
      backgroundColor: 'rgba(255,255,255,0.03)',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <TextInput
          value={field.label}
          onChangeText={t => onChange(field.id, 'label', t)}
          placeholder="Field label (e.g. Internship at ABC)"
          placeholderTextColor={colors.textMuted}
          style={[inputBase, { flex: 1, fontSize: 12, fontFamily: 'Inter_600SemiBold' }]}
          returnKeyType="next"
        />
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onDelete(field.id); }}
          style={{
            width: 32, height: 32, borderRadius: 8,
            backgroundColor: colors.dangerBg,
            alignItems: 'center', justifyContent: 'center',
          }}
          accessibilityLabel="Delete field"
        >
          <Feather name="trash-2" size={14} color={colors.danger} />
        </Pressable>
      </View>
      <TextInput
        value={field.value}
        onChangeText={t => onChange(field.id, 'value', t)}
        placeholder="Value"
        placeholderTextColor={colors.textMuted}
        style={[inputBase, { minHeight: 44, textAlignVertical: 'top' }]}
        multiline
      />
    </View>
  );
}

function EmptyFieldsPlaceholder({ colors, onStartAI }: { colors: ReturnType<typeof useColors>; onStartAI: () => void }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 32, paddingHorizontal: 16 }}>
      <View style={{
        width: 56, height: 56, borderRadius: 28,
        backgroundColor: colors.indigoBg,
        alignItems: 'center', justifyContent: 'center',
        marginBottom: 14,
      }}>
        <Text style={{ fontSize: 22 }}>✦</Text>
      </View>
      <Text style={{ fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.text, marginBottom: 6 }}>
        No profile details yet
      </Text>
      <Text style={{
        fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textMuted,
        textAlign: 'center', lineHeight: 19, marginBottom: 20,
      }}>
        Chat with Career Compass AI to build your profile automatically, or tap Edit to add details manually.
      </Text>
      <Pressable
        onPress={onStartAI}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: 8,
          backgroundColor: colors.primary, borderRadius: 12,
          paddingHorizontal: 20, paddingVertical: 12,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text style={{ fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' }}>Build with AI</Text>
        <Feather name="arrow-right" size={14} color="#fff" />
      </Pressable>
    </View>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, updateProfile, applications, contacts, docs, clearAllData, themeOverride, setThemeOverride, signOut } = useApp();

  const [isEditing, setIsEditing] = useState(false);
  const [editFields, setEditFields] = useState<ProfileField[]>([]);
  const [editName, setEditName] = useState('');
  const [editLinkedIn, setEditLinkedIn] = useState('');
  const [editGithub, setEditGithub] = useState('');
  const [editPortfolio, setEditPortfolio] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const topPad = Platform.OS === 'web' ? 16 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 72 : insets.bottom + 56;

  const profileFields: ProfileField[] = profile?.profileFields ?? [];
  const hasFields = profileFields.length > 0;

  const derivedName = profile?.displayName && profile.displayName !== 'You'
    ? profile.displayName
    : getFieldValue(profileFields, 'full name', 'name') || '';

  const derivedDegree = getFieldValue(profileFields, 'current degree', 'degree', 'qualification')
    ?? (profile?.currentDegree || '');
  const derivedInstitution = getFieldValue(profileFields, 'institution', 'university', 'college')
    ?? (profile?.institution || '');
  const derivedYear = getFieldValue(profileFields, 'year of study', 'year')
    ?? (profile?.yearOfStudy || '');

  const coreScore = [
    !!str(profile?.displayName).trim() && str(profile?.displayName) !== 'You',
    !!str(profile?.currentDegree).trim(),
    !!str(profile?.institution).trim(),
    !!str(profile?.yearOfStudy).trim(),
    !!str(profile?.skills).trim(),
    !!str(profile?.city).trim(),
    !!str(profile?.preferredIndustries).trim(),
    !!str(profile?.careerGoals).trim(),
    !!str(profile?.portfolioUrl).trim(),
  ].filter(Boolean).length;
  const fieldScore = Math.min(profileFields.length, 10);
  const completenessPercent = Math.min(100, Math.round(((coreScore + fieldScore) / 19) * 100));

  const openEdit = () => {
    setEditFields(profileFields.map(f => ({ ...f })));
    setEditName(derivedName);
    setEditLinkedIn(profile?.linkedInUrl ?? '');
    setEditGithub(profile?.githubUrl ?? '');
    setEditPortfolio(profile?.portfolioUrl ?? '');
    setNewLabel('');
    setIsEditing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setNewLabel('');
  };

  const handleFieldChange = (id: string, key: 'label' | 'value', text: string) => {
    setEditFields(prev => prev.map(f => f.id === id ? { ...f, [key]: text } : f));
  };

  const handleDeleteField = (id: string) => {
    confirmDialog(
      'Remove field',
      'Delete this profile field?',
      () => setEditFields(prev => prev.filter(f => f.id !== id)),
      'Delete',
    );
  };

  const handleAddField = () => {
    const label = newLabel.trim();
    if (!label) return;
    setEditFields(prev => [...prev, { id: genId(), label, value: '' }]);
    setNewLabel('');
    Haptics.selectionAsync();
  };

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const cleaned = editFields.filter(f => f.label.trim() && f.value.trim());
    const nameField = editName.trim();

    const newName = nameField || getFieldValue(cleaned, 'full name', 'name') || profile.displayName;
    const newDegree = getFieldValue(cleaned, 'current degree', 'degree', 'qualification') || profile.currentDegree;
    const newInstitution = getFieldValue(cleaned, 'institution', 'university', 'college') || profile.institution;
    const newYear = getFieldValue(cleaned, 'year of study', 'year') || profile.yearOfStudy;
    const newSkills = getFieldValue(cleaned, 'technical skills', 'skills') || profile.skills;
    const newCity = getFieldValue(cleaned, 'city', 'location') || profile.city;
    const newIndustries = getFieldValue(cleaned, 'preferred industries', 'industries') || str(profile.preferredIndustries);
    const newGoals = getFieldValue(cleaned, 'career goals', 'goals') || profile.careerGoals;
    const newPortfolio = editPortfolio.trim() || getFieldValue(cleaned, 'portfolio') || profile.portfolioUrl;

    await updateProfile({
      ...profile,
      displayName: newName,
      currentDegree: newDegree,
      institution: newInstitution,
      yearOfStudy: newYear,
      skills: newSkills,
      city: newCity,
      preferredIndustries: newIndustries,
      careerGoals: newGoals,
      portfolioUrl: newPortfolio,
      linkedInUrl: editLinkedIn.trim() || profile.linkedInUrl,
      githubUrl: editGithub.trim() || profile.githubUrl,
      profileFields: cleaned,
    });
    setSaving(false);
    setIsEditing(false);
  };

  const handlePickProfileImage = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photos to set a profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    });
    if (!result.canceled && result.assets[0] && profile) {
      setUploadingImage(true);
      try {
        const asset = result.assets[0];
        // Store as a portable data URI so the image syncs across devices
        // via the existing Supabase cloud-sync (pushCloudData) — no local
        // file path that disappears on another device.
        const imageUri = asset.base64
          ? `data:image/jpeg;base64,${asset.base64}`
          : asset.uri;
        await updateProfile({ ...profile, profileImageUri: imageUri });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } finally {
        setUploadingImage(false);
      }
    }
  };

  const handleReset = () => {
    const appCount = applications.length;
    const contactCount = contacts.length;
    doubleConfirmDialog(
      '⚠️ Reset All Data',
      `This will permanently delete:\n\n• Your profile\n• ${appCount} application${appCount !== 1 ? 's' : ''}\n• ${contactCount} contact${contactCount !== 1 ? 's' : ''}\n• All saved events & documents\n\nThis CANNOT be undone.`,
      'Are you absolutely sure?',
      'Everything will be permanently deleted. There is no recovery after this.',
      async () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        await clearAllData();
        setIsEditing(false);
      },
      'Yes, delete everything',
    );
  };

  const s = styles(colors);

  return (
    <KeyboardAwareScrollView
      style={s.screen}
      contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: bottomPad + 24, paddingHorizontal: 20 }}
      bottomOffset={20}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator
      indicatorStyle={colors.isDark ? 'white' : 'black'}
    >
      {/* ── Avatar ── */}
      <View style={s.avatarSection}>
        <Pressable
          onPress={uploadingImage ? undefined : handlePickProfileImage}
          style={[s.avatarWrap, uploadingImage && { opacity: 0.7 }]}
          accessibilityLabel="Change profile photo"
          accessibilityRole="button"
        >
          {profile?.profileImageUri ? (
            <Image
              source={{ uri: profile.profileImageUri }}
              style={s.avatarImg}
              contentFit="cover"
            />
          ) : (
            <View style={s.avatar}>
              <Text style={s.avatarText}>{(derivedName[0] || 'Y').toUpperCase()}</Text>
            </View>
          )}
          <View style={s.avatarCameraBtn}>
            {uploadingImage
              ? <ActivityIndicator size={12} color="#fff" />
              : <Feather name="camera" size={12} color="#fff" />}
          </View>
        </Pressable>
        <Text style={s.avatarName}>{derivedName || 'Your Name'}</Text>
        {(!!derivedYear || !!derivedDegree) && (
          <Text style={s.avatarSub}>
            {[derivedYear, derivedDegree].filter(Boolean).join(' · ')}
          </Text>
        )}
        {!!derivedInstitution && (
          <Text style={s.avatarInstitution}>{derivedInstitution}</Text>
        )}
      </View>

      {/* ── Stats row ── */}
      <View style={s.statsRow}>
        <View style={s.statCard}>
          <Text style={s.statValue}>{applications.length}</Text>
          <Text style={s.statLabel}>Applications</Text>
        </View>
        <View style={[s.statCard, { borderColor: colors.blueBorder }]}>
          <Text style={[s.statValue, { color: colors.blue }]}>{contacts.length}</Text>
          <Text style={s.statLabel}>Contacts</Text>
        </View>
        <View style={[s.statCard, {
          borderColor: completenessPercent >= 80 ? colors.successBorder : colors.warningBorder,
          backgroundColor: completenessPercent >= 80 ? colors.successBg : colors.warningBg,
        }]}>
          <Text style={[s.statValue, { color: completenessPercent >= 80 ? colors.success : colors.warning }]}>
            {completenessPercent}%
          </Text>
          <Text style={s.statLabel}>Profile</Text>
        </View>
      </View>

      {/* ── Progress bar ── */}
      <View style={s.progressWrap}>
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${completenessPercent}%` as any }]} />
        </View>
        <Text style={s.progressLabel}>
          {hasFields
            ? `${profileFields.length} profile field${profileFields.length !== 1 ? 's' : ''} · ${completenessPercent < 100 ? 'more detail = better AI results' : 'Fully set up ✓'}`
            : completenessPercent < 100 ? 'Add more info for better AI results' : 'Profile fully set up ✓'}
        </Text>
      </View>

      {/* ── AI banner ── */}
      <Pressable
        style={({ pressed }) => [s.aiBanner, pressed && { opacity: 0.82 }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/onboarding'); }}
        android_ripple={{ color: 'rgba(99,102,241,0.2)' }}
        accessibilityLabel="Update profile with AI"
      >
        <View style={s.aiBannerLeft}>
          <View style={s.aiIconWrap}>
            <Text style={{ fontSize: 14 }}>✦</Text>
          </View>
          <View>
            <Text style={s.aiBannerTitle}>{hasFields ? 'Update with AI' : 'Build with AI'}</Text>
            <Text style={s.aiBannerSub}>
              {hasFields ? 'Chat to update your profile' : 'Let AI collect your details in a conversation'}
            </Text>
          </View>
        </View>
        <Feather name="chevron-right" size={16} color={colors.primary} />
      </Pressable>

      {/* ── Profile details card (view mode) ── */}
      {!isEditing && (
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>Profile Details</Text>
            <Pressable
              style={({ pressed }) => [s.editBtn, pressed && { opacity: 0.75 }]}
              onPress={openEdit}
              accessibilityLabel="Edit profile"
            >
              <Feather name="edit-2" size={13} color={colors.primary} />
              <Text style={s.editBtnText}>Edit</Text>
            </Pressable>
          </View>

          {hasFields ? (
            (() => {
              const seen = new Map<string, { label: string; fields: ProfileField[] }>();
              const order: string[] = [];
              for (const f of profileFields) {
                const key = f.label.trim().toLowerCase();
                if (!seen.has(key)) {
                  seen.set(key, { label: f.label.trim(), fields: [] });
                  order.push(key);
                }
                seen.get(key)!.fields.push(f);
              }
              return order.map((key, i) => {
                const group = seen.get(key)!;
                return (
                  <GroupedFieldView
                    key={key}
                    label={group.label}
                    fields={group.fields}
                    isLast={i === order.length - 1}
                    colors={colors}
                  />
                );
              });
            })()
          ) : (
            <EmptyFieldsPlaceholder colors={colors} onStartAI={() => router.push('/onboarding')} />
          )}
        </View>
      )}

      {/* ── My Docs card (view mode) ── */}
      {!isEditing && (
        <Pressable
          style={({ pressed }) => [s.card, {
            flexDirection: 'row', alignItems: 'center', gap: 10,
            paddingVertical: 10, paddingHorizontal: 14,
            opacity: pressed ? 0.82 : 1,
          }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/docs'); }}
          android_ripple={{ color: 'rgba(99,102,241,0.15)' }}
          accessibilityLabel="My Documents"
        >
          <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: colors.blueBg, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="folder" size={13} color={colors.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.text }}>My Documents</Text>
            <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginTop: 1 }}>
              {docs.length === 0 ? 'CV, letters, certificates & more' : `${docs.length} file${docs.length !== 1 ? 's' : ''} stored`}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {docs.length > 0 && (
              <View style={{
                backgroundColor: colors.primary, borderRadius: 10,
                paddingHorizontal: 6, paddingVertical: 2,
              }}>
                <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' }}>{docs.length}</Text>
              </View>
            )}
            <Feather name="chevron-right" size={14} color={colors.textMuted} />
          </View>
        </Pressable>
      )}

      {/* ── Social Links (view mode) ── */}
      {!isEditing && (profile?.linkedInUrl || profile?.githubUrl || profile?.portfolioUrl) && (
        <View style={s.card}>
          <Text style={[s.cardTitle, { marginBottom: 10 }]}>Social Links</Text>
          {[
            { key: 'linkedInUrl', label: 'LinkedIn', icon: 'linkedin' as const, url: profile?.linkedInUrl },
            { key: 'githubUrl', label: 'GitHub', icon: 'github' as const, url: profile?.githubUrl },
            { key: 'portfolioUrl', label: 'Portfolio', icon: 'globe' as const, url: profile?.portfolioUrl },
          ].filter(l => l.url?.trim()).map((link, i, arr) => {
            // Normalise URL (add https:// if bare www. or no scheme)
            let url = link.url!.trim();
            if (url.startsWith('www.')) url = `https://${url}`;
            else if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
            return (
              <Pressable
                key={link.key}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  Linking.canOpenURL(url).then(ok => {
                    if (ok) Linking.openURL(url);
                    else if (Platform.OS === 'web') window.open(url, '_blank');
                    else Alert.alert('Cannot open link', url);
                  }).catch(() => {
                    if (Platform.OS === 'web') window.open(url, '_blank');
                    else Alert.alert('Cannot open link', url);
                  });
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  paddingVertical: 11,
                  borderBottomWidth: i < arr.length - 1 ? 1 : 0,
                  borderBottomColor: colors.divider,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View style={{
                  width: 32, height: 32, borderRadius: 8,
                  backgroundColor: colors.indigoBg, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: colors.indigoBorder,
                }}>
                  <Feather name={link.icon} size={14} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }}>{link.label}</Text>
                  <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.primary, marginTop: 1 }} numberOfLines={1}>{url}</Text>
                </View>
                <Feather name="external-link" size={13} color={colors.textMuted} />
              </Pressable>
            );
          })}
        </View>
      )}

      {/* ── Edit form ── */}
      {isEditing && (
        <View style={s.editForm}>
          <View style={s.editFormHeader}>
            <Text style={s.editFormTitle}>Edit Profile</Text>
            <Pressable onPress={cancelEdit} style={s.cancelBtn}>
              <Feather name="x" size={16} color={colors.textMuted} />
              <Text style={s.cancelBtnText}>Cancel</Text>
            </Pressable>
          </View>

          {/* Display name override */}
          <View style={{ marginBottom: 20 }}>
            <Text style={s.editGroupLabel}>Display Name</Text>
            <TextInput
              value={editName}
              onChangeText={setEditName}
              placeholder="Your full name"
              placeholderTextColor={colors.textMuted}
              style={{
                backgroundColor: colors.muted, borderRadius: 12, padding: 14,
                fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.text,
                borderWidth: 1, borderColor: colors.border,
              }}
            />
          </View>

          {/* Social Links */}
          <View style={{ marginBottom: 20 }}>
            <Text style={s.editGroupLabel}>Social Links</Text>
            {[
              { label: 'LinkedIn URL', value: editLinkedIn, setter: setEditLinkedIn, placeholder: 'https://linkedin.com/in/yourname' },
              { label: 'GitHub URL', value: editGithub, setter: setEditGithub, placeholder: 'https://github.com/yourname' },
              { label: 'Portfolio / Website', value: editPortfolio, setter: setEditPortfolio, placeholder: 'https://yourportfolio.com' },
            ].map(({ label, value, setter, placeholder }) => (
              <View key={label} style={{ marginBottom: 10 }}>
                <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.textMuted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Text>
                <TextInput
                  value={value}
                  onChangeText={setter}
                  placeholder={placeholder}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  keyboardType="url"
                  style={{
                    backgroundColor: colors.muted, borderRadius: 12, padding: 12,
                    fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.text,
                    borderWidth: 1, borderColor: colors.border,
                  }}
                />
              </View>
            ))}
          </View>


          {/* Dynamic profile fields */}
          <Text style={[s.editGroupLabel, { marginBottom: 10 }]}>Profile Fields</Text>
          <Text style={{
            fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textMuted,
            marginBottom: 14, lineHeight: 17,
          }}>
            Add, edit, or remove any field. Use clear labels like "Work Experience", "Python", "Zulu (Fluent)", etc.
          </Text>

          {editFields.length === 0 && (
            <View style={{
              paddingVertical: 20, alignItems: 'center',
              borderRadius: 12, borderWidth: 1, borderColor: colors.border,
              borderStyle: 'dashed', marginBottom: 14,
            }}>
              <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textMuted }}>
                No fields yet — add one below
              </Text>
            </View>
          )}

          {editFields.map((field) => (
            <FieldEditRow
              key={field.id}
              field={field}
              onChange={handleFieldChange}
              onDelete={handleDeleteField}
              colors={colors}
            />
          ))}

          {/* Add new field */}
          <View style={{
            flexDirection: 'row', gap: 8, alignItems: 'center',
            marginBottom: 24, marginTop: 4,
          }}>
            <TextInput
              value={newLabel}
              onChangeText={setNewLabel}
              placeholder="New field label…"
              placeholderTextColor={colors.textMuted}
              style={{
                flex: 1,
                backgroundColor: colors.muted, borderRadius: 12,
                paddingHorizontal: 14, paddingVertical: 12,
                fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.text,
                borderWidth: 1, borderColor: colors.border,
              }}
              returnKeyType="done"
              onSubmitEditing={handleAddField}
            />
            <Pressable
              onPress={handleAddField}
              style={({ pressed }) => ({
                paddingHorizontal: 16, paddingVertical: 12,
                backgroundColor: newLabel.trim() ? colors.primary : colors.muted,
                borderRadius: 12, borderWidth: 1,
                borderColor: newLabel.trim() ? colors.primary : colors.border,
                opacity: pressed ? 0.85 : 1,
              })}
              disabled={!newLabel.trim()}
              accessibilityLabel="Add field"
            >
              <Feather name="plus" size={18} color={newLabel.trim() ? '#fff' : colors.textMuted} />
            </Pressable>
          </View>

          {/* Save */}
          <Pressable
            style={({ pressed }) => [s.saveBtn, pressed && { opacity: 0.85 }, saving && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={saving}
            android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
            accessibilityLabel="Save profile"
          >
            <Feather name="check" size={18} color="#fff" />
            <Text style={s.saveBtnText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
          </Pressable>
        </View>
      )}

      {/* ── Appearance ── */}
      <View style={s.card}>
        <View style={s.appearanceHeader}>
          <View style={s.appearanceHeaderLeft}>
            <Feather name="sun" size={14} color={colors.primary} />
            <Text style={s.sectionHeading}>Appearance</Text>
          </View>
          <Text style={s.appearanceValue}>
            {themeOverride === 'system' ? 'Auto' : themeOverride === 'light' ? 'Light' : 'Dark'}
          </Text>
        </View>
        <View style={s.themeSegmentTrack}>
          {(
            [
              { key: 'system', label: 'Auto', icon: 'smartphone' },
              { key: 'light', label: 'Light', icon: 'sun' },
              { key: 'dark', label: 'Dark', icon: 'moon' },
            ] as { key: ThemeOverride; label: string; icon: string }[]
          ).map((opt) => {
            const active = themeOverride === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => {
                  Haptics.selectionAsync();
                  setThemeOverride(opt.key);
                }}
                style={[s.themeSegment, active && s.themeSegmentActive]}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
              >
                <Feather
                  name={opt.icon as any}
                  size={13}
                  color={active ? colors.primary : colors.textMuted}
                />
                <Text style={[s.themeSegmentLabel, active && s.themeSegmentLabelActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* ── Sign Out ── */}
      <Pressable
        style={({ pressed }) => [s.signOutBtn, pressed && { opacity: 0.85 }]}
        onPress={() => {
          confirmDialog(
            'Sign Out',
            'Are you sure you want to sign out?',
            () => signOut(),
            'Sign Out',
          );
        }}
        android_ripple={{ color: colors.indigoBg }}
        accessibilityLabel="Sign out"
      >
        <Feather name="log-out" size={14} color={colors.primary} />
        <Text style={s.signOutBtnText}>Sign Out</Text>
      </Pressable>

      {/* ── Danger zone ── */}
      <Pressable
        style={({ pressed }) => [s.resetBtn, pressed && { opacity: 0.85 }]}
        onPress={handleReset}
        android_ripple={{ color: colors.dangerBg }}
        accessibilityLabel="Reset all data"
      >
        <Feather name="trash-2" size={14} color={colors.danger} />
        <Text style={s.resetBtnText}>Reset All Data</Text>
      </Pressable>
    </KeyboardAwareScrollView>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },

  avatarSection: { alignItems: 'center', marginBottom: 28 },
  avatarWrap: { position: 'relative', marginBottom: 12, alignSelf: 'center' },
  avatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: colors.indigoBg,
    borderWidth: 3, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImg: {
    width: 84, height: 84, borderRadius: 42,
    borderWidth: 2.5, borderColor: colors.primary,
  } as any,
  avatarCameraBtn: {
    position: 'absolute', bottom: 0, right: -2,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.background,
  },
  avatarText: { fontSize: 34, fontFamily: 'Inter_700Bold', color: colors.primary },
  avatarName: { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.text, letterSpacing: -0.4, marginBottom: 3 },
  avatarSub: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.textSecondary, marginBottom: 2 },
  avatarInstitution: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textMuted },

  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 18 },
  statCard: {
    flex: 1, alignItems: 'center', paddingVertical: 20,
    backgroundColor: colors.indigoBg, borderRadius: 18,
    borderWidth: 1, borderColor: colors.indigoBorder,
  },
  statValue: { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.primary, letterSpacing: -0.5 },
  statLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },

  progressWrap: { marginBottom: 16 },
  progressTrack: { height: 4, backgroundColor: colors.muted, borderRadius: 2, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: 4, backgroundColor: colors.success, borderRadius: 2 },
  progressLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted, textAlign: 'center' },

  aiBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.indigoBg,
    borderRadius: 20, borderWidth: 1, borderColor: colors.indigoBorder,
    paddingHorizontal: 20, paddingVertical: 20,
    marginBottom: 16,
  },
  aiBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  aiIconWrap: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  aiBannerTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },
  aiBannerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginTop: 1, maxWidth: 200 },

  card: {
    backgroundColor: colors.card,
    borderRadius: 20, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 20, paddingVertical: 18,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 4,
  },
  cardHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 16,
  },
  cardTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.text },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.indigoBg,
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: colors.indigoBorder,
  },
  editBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.primary },

  editForm: {
    backgroundColor: colors.card,
    borderRadius: 18, borderWidth: 1, borderColor: colors.border,
    padding: 16,
    marginBottom: 10,
  },
  editFormHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 20,
  },
  editFormTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.text },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cancelBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.textMuted },
  editGroupLabel: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold',
    color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 8,
  },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: 16,
    paddingVertical: 17,
    shadowColor: '#3730a3',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 7,
  },
  saveBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },

  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 8, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1, borderColor: colors.indigoBorder,
    backgroundColor: colors.indigoBg,
  },
  signOutBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.primary },

  resetBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 8, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1, borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerBg,
  },
  resetBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.danger },

  sectionHeading: {
    fontSize: 11, fontFamily: 'Inter_700Bold',
    color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.9,
    marginBottom: 0,
  },

  appearanceHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  appearanceHeaderLeft: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  appearanceValue: {
    fontSize: 11, fontFamily: 'Inter_500Medium',
    color: colors.primary,
    letterSpacing: 0.1,
  },
  themeSegmentTrack: {
    flexDirection: 'row',
    backgroundColor: colors.muted,
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  themeSegment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRadius: 8,
    gap: 3,
  },
  themeSegmentActive: {
    backgroundColor: colors.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: colors.isDark ? 0.3 : 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  themeSegmentLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: colors.textMuted,
    textAlign: 'center',
    letterSpacing: 0.1,
  },
  themeSegmentLabelActive: {
    color: colors.primary,
  },
});
