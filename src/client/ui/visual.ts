import type { StageId } from '../../shared/domain';

export const STAGE_COLORS: Record<StageId, { bg: string; fg: string; dot: string }> = {
  new: { bg: '#eef1f6', fg: '#3d4a63', dot: '#8a96ad' },
  contacted: { bg: '#e7f0fd', fg: '#1f5bb8', dot: '#4c8ae8' },
  demo: { bg: '#e8f6f6', fg: '#16706f', dot: '#2fa5a3' },
  proposal: { bg: '#fdf3e2', fg: '#9a5b00', dot: '#e09a2d' },
  negotiation: { bg: '#f4ebfd', fg: '#6a3bb5', dot: '#9b6ae0' },
  won: { bg: '#e4f4ea', fg: '#1f7a45', dot: '#34a865' },
  lost: { bg: '#fbe9e9', fg: '#a83232', dot: '#d65a5a' },
};

const AVATAR = ['#4c6ef5', '#12b886', '#f59f00', '#e64980', '#7950f2', '#15aabf', '#fa5252', '#40c057', '#fd7e14', '#228be6'];
export const avatarColor = (ownerId: string) => AVATAR[Number(ownerId.slice(1)) % AVATAR.length];
